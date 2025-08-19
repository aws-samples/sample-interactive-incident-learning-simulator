#!/bin/bash

# Update and install required packages
dnf update -y
dnf install -y java-17-amazon-corretto
dnf install -y amazon-cloudwatch-agent
dnf install -y jq

# Create application directory
mkdir -p /opt/app
cd /opt/app

# Download application source code from S3
aws s3 cp ${APP_ASSET_S3_URL} /tmp/demoapp.zip
mkdir -p /opt/app/src
cd /opt/app/src
unzip /tmp/demoapp.zip
rm /tmp/demoapp.zip

# Install required build tools
dnf install -y git

# Build the application
cd /opt/app/src
./gradlew build
cp build/libs/webapp-java-0.0.1-SNAPSHOT.jar /opt/app/demoapp.jar

# Download RDS certificate bundle
curl https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /opt/app/root.pem

# Create service user
useradd -r spring
chown -R spring:spring /opt/app

# Create systemd service file for the application
cat > /etc/systemd/system/demoapp.service << EOL
[Unit]
Description=Demo Java Application
After=network.target

[Service]
User=spring
WorkingDirectory=/opt/app
EnvironmentFile=/etc/environment.d/demoapp.conf
ExecStart=/usr/bin/java -javaagent:/opt/aws/aws-opentelemetry-agent/lib/aws-opentelemetry-agent.jar -Dspring.config.additional-location=file:/opt/app/application.properties -Dlogging.level.org.springframework=DEBUG -jar /opt/app/demoapp.jar
SuccessExitStatus=143
TimeoutStopSec=10
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOL

# Create script to fetch Aurora credentials from Secrets Manager and directly update application.properties
cat > /opt/app/setup-db-config.sh << 'EOL'
#!/bin/bash
SECRET_NAME="${AURORA_SECRET_NAME}"
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --query SecretString --output text)
DB_HOST=$(echo $SECRET_JSON | jq -r .host)
DB_USERNAME=$(echo $SECRET_JSON | jq -r .username)
DB_PASSWORD=$(echo $SECRET_JSON | jq -r .password)

echo "DB_HOST: $DB_HOST"
echo "DB_USERNAME: $DB_USERNAME"

# Create environment variables file for systemd
mkdir -p /etc/environment.d
echo "DB_HOST=$DB_HOST" > /etc/environment.d/demoapp.conf
echo "DB_USERNAME=$DB_USERNAME" >> /etc/environment.d/demoapp.conf
echo "DB_PASSWORD=$DB_PASSWORD" >> /etc/environment.d/demoapp.conf
echo "JAVA_TOOL_OPTIONS=-Daws.region=${AWS_REGION}" >> /etc/environment.d/demoapp.conf
echo "OTEL_RESOURCE_ATTRIBUTES=service.name=todo-app" >> /etc/environment.d/demoapp.conf
echo "OTEL_METRICS_EXPORTER=none" >> /etc/environment.d/demoapp.conf
echo "OTEL_LOGS_EXPORTER=none" >> /etc/environment.d/demoapp.conf
echo "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf" >> /etc/environment.d/demoapp.conf
echo "OTEL_AWS_APPLICATION_SIGNALS_ENABLED=true" >> /etc/environment.d/demoapp.conf
echo "OTEL_AWS_APPLICATION_SIGNALS_EXPORTER_ENDPOINT=http://localhost:4316/v1/metrics" >> /etc/environment.d/demoapp.conf
echo "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4316/v1/traces" >> /etc/environment.d/demoapp.conf

# Create application.properties with explicit database host - directly expanding variables
cat > /opt/app/application.properties << EOF
spring.datasource.url=jdbc:postgresql://$DB_HOST:5432/postgres?sslmode=verify-full&sslrootcert=/opt/app/root.pem
spring.datasource.username=$DB_USERNAME
spring.datasource.password=$DB_PASSWORD
spring.datasource.driver-class-name=org.postgresql.Driver
spring.sql.init.mode=always

# Actuator settings
management.endpoints.web.exposure.include=health,info
management.endpoint.health.show-details=always
management.health.db.enabled=true
management.health.diskspace.enabled=true
logging.level.org.springframework=DEBUG
logging.level.com.example=DEBUG
EOF

# Set proper permissions
chown spring:spring /opt/app/application.properties
chmod 644 /opt/app/application.properties
EOL

# Make script executable
chmod +x /opt/app/setup-db-config.sh

# Execute the script to set up database configuration
/opt/app/setup-db-config.sh

# Install AWS OpenTelemetry Agent for Application Signals
mkdir -p /opt/aws/aws-opentelemetry-agent/lib
curl -L https://github.com/aws-observability/aws-otel-java-instrumentation/releases/latest/download/aws-opentelemetry-agent.jar -o /opt/aws/aws-opentelemetry-agent/lib/aws-opentelemetry-agent.jar
chmod 755 /opt/aws/aws-opentelemetry-agent/lib/aws-opentelemetry-agent.jar
chown -R spring:spring /opt/aws

# Create logging directory for demoapp
mkdir -p /var/log/demoapp
chown spring:spring /var/log/demoapp
chmod 775 /var/log/demoapp

# rsyslog install and enable
dnf update -y
dnf install -y rsyslog
systemctl enable rsyslog
systemctl start rsyslog

# Install CloudWatch Agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOL
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "traces": {
    "traces_collected": {
      "application_signals": {}
    }
  },
  "logs": {
    "metrics_collected": {
      "application_signals": {}
    },
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/messages",
            "log_group_name": "/ec2/messages",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/var/log/secure",
            "log_group_name": "/ec2/secure",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/var/log/demoapp/application.log",
            "log_group_name": "/ec2/demoapp",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "DemoApp",
    "metrics_collected": {
      "cpu": {
        "resources": ["*"],
        "measurement": ["cpu_usage_idle", "cpu_usage_user", "cpu_usage_system"]
      },
      "mem": {
        "measurement": ["mem_used_percent"]
      },
      "disk": {
        "resources": ["/"],
        "measurement": ["disk_used_percent"]
      },
      "procstat": [
        {
          "pattern": "demoapp",
          "measurement": [
            "pid_count"
          ]
        }
      ]
    }
  }
}
EOL

SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id ${AURORA_SECRET_NAME} --query SecretString --output text)
DB_HOST=$(echo $SECRET_JSON | jq -r .host)
DB_USERNAME=$(echo $SECRET_JSON | jq -r .username)
DB_PASSWORD=$(echo $SECRET_JSON | jq -r .password)

# Start services
systemctl enable amazon-cloudwatch-agent
systemctl start amazon-cloudwatch-agent
systemctl enable demoapp
systemctl start demoapp
