# For build
FROM --platform=linux/arm64 amazoncorretto:17-alpine AS build
RUN apk update && apk add curl 

ENV HOME=/home/app
RUN mkdir -p $HOME
WORKDIR $HOME
ADD . $HOME
RUN curl https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o $HOME/root.pem
RUN ./gradlew build

# For app
FROM --platform=linux/arm64 amazoncorretto:17-alpine

VOLUME /home/spring
VOLUME /tmp

RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring

COPY --from=build /home/app/build/libs/webapp-java-0.0.1-SNAPSHOT.jar demoapp.jar
COPY --from=build /home/app/root.pem /tmp/root.pem
CMD ["java","-jar","/demoapp.jar"]
