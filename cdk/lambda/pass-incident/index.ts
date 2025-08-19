import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";

/**
 * Event サンプル
{
  "Records": [
    {
      "EventSource": "aws:sns",
      "EventVersion": "1.0",
      "EventSubscriptionArn": "arn:aws:sns:us-west-2:148991357402:InteractiveIncidentLearningSimulatorStack-EventsSecurityScenarioTopic616C962C-Y2jp0bNqZSdp",
      "Sns": {
        "Type": "Notification",
        "MessageId": "95df01b4-ee98-5cb9-9903-4c221d41eb5e",
        "TopicArn": "arn:aws:sns:us-east-1:123456789012:ExampleTopic",
        "Subject": "example subject",
        "Message": "{\"eventID\":\"dadc9f0c4a973bb4aa2f61915b51ad6d\",\"eventName\":\"MODIFY\",\"eventVersion\":\"1.1\",\"eventSource\":\"aws:dynamodb\",\"awsRegion\":\"ap-northeast-1\",\"dynamodb\": {\"ApproximateCreationDateTime\":1747900674,\"Keys\":{\"ComponentName\":{\"S\":\"EC2 SG\"}},\"NewImage\":{\"CurrentState\":{\"S\":\"Red\"},\"ComponentName\":{\"S\":\"EC2 SG\"}},\"SequenceNumber\":\"172882900003850257536690547\",\"SizeBytes\":55,\"StreamViewType\":\"NEW_IMAGE\"},\"eventSourceARN\":\"arn:aws:dynamodb:ap-northeast-1:211125508552:table/SecurityScenarioTable/stream/2025-05-22T07:54:05.035\"}",
        "Timestamp": "1970-01-01T00:00:00.000Z",
        "SignatureVersion": "1",
        "Signature": "EXAMPLE",
        "SigningCertUrl": "EXAMPLE",
        "UnsubscribeUrl": "EXAMPLE",
        "MessageAttributes": {
          "Test": {
            "Type": "String",
            "Value": "TestString"
          },
          "TestBinary": {
            "Type": "Binary",
            "Value": "TestBinary"
          }
        }
      }
    }
  ]
}
 */

interface UpdateEventObject {
  eventID: string;
  eventName: string;
  eventVersion: string;
  eventSource: string;
  awsRegion: string;
  dynamodb: UpdateDynamoInfo;
  eventSourceARN: string;
}

interface UpdateDynamoInfo {
  ApproximateCreationDateTime: number;
  Keys: {
    ComponentName: {
      S: string;
    };
  };
  NewImage: {
    CurrentState: {
      S: string;
    };
    ComponentName: {
      S: string;
    };
  };

  SequenceNumber: number;
  StreamViewType: string;
}

const eventTypeViaSNS = {
  ec2sg: "EC2 SG",
  albsg: "ALB SG",
  ec2role: "EC2 Role",
  s3: "S3",
  rdssg: "RDS SG",
  cloudtrail: "CloudTrail",
  ec2os: "EC2",
  ec2process: "EC2 Process",
};

const eventStatusViaSNS = {
  green: "Green",
  red: "Red",
};

const eventStateViaSNS = {
  ongoing: "Ongoing",
  ready: "Ready",
  resetting: "Resetting",
};

const componentAppSyncType = {
  albsg: "albsg",
  ec2: "ec2",
  ec2sg: "ec2sg",
  rdssg: "rdssg",
  s3: "s3",
  cloudtrail: "cloudtrail",
};

const componentStateAppSyncType = {
  normal: "normal",
  incident: "incident",
};

const gamestateAppSyncType = {
  ongoing: "ongoing",
  ready: "ready",
  resetting: "resetting",
};

const client = generateClient();

Amplify.configure({
  API: {
    GraphQL: {
      endpoint: process.env.APPSYNC_API_URL!,
      region: process.env.AWS_REGION!,
      defaultAuthMode: "apiKey",
      apiKey: process.env.APPSYNC_API_KEY!,
    },
  },
});

const updatedCompnent = /* GraphQL */ `
  mutation UpdatedCompnent($input: ComponentInput!) {
    updatedCompnent(input: $input) {
      component
      state
      __typename
    }
  }
`;

const updatedGameState = /* GraphQL */ `
  mutation UpdatedGameState($input: GameStateInput!) {
    updatedGameState(input: $input) {
      state
      __typename
    }
  }
`;

export const handler = async (event: {
  Records: { Sns: { Message: string } }[];
}): Promise<void> => {
  console.log(event.Records[0].Sns);
  const dynamodbStreamEvent = JSON.parse(event.Records[0].Sns.Message);
  if (dynamodbStreamEvent.dynamodb.NewImage.ComponentName) {
    const componentType = dynamodbStreamEvent.dynamodb.NewImage.ComponentName.S;
    const statusType = dynamodbStreamEvent.dynamodb.NewImage.CurrentState.S;

    let sendComponentType: string = "";
    let sendStatusType: string = "";

    // ステータスの値をマッピング
    if (statusType === eventStatusViaSNS.green) {
      sendStatusType = componentStateAppSyncType.normal;
    } else if (statusType === eventStatusViaSNS.red) {
      sendStatusType = componentStateAppSyncType.incident;
    }

    // コンポーネントの値をマッピング
    if (componentType === eventTypeViaSNS.albsg) {
      sendComponentType = componentAppSyncType.albsg;
    } else if (componentType === eventTypeViaSNS.ec2sg) {
      sendComponentType = componentAppSyncType.ec2sg;
    } else if (componentType === eventTypeViaSNS.ec2role) {
      // ToDo: EC2 で良いのか？
      sendComponentType = componentAppSyncType.ec2;
    } else if (componentType === eventTypeViaSNS.rdssg) {
      sendComponentType = componentAppSyncType.rdssg;
    } else if (componentType === eventTypeViaSNS.s3) {
      sendComponentType = componentAppSyncType.s3;
    } else if (componentType === eventTypeViaSNS.cloudtrail) {
      sendComponentType = componentAppSyncType.cloudtrail;
    } else if (componentType === eventTypeViaSNS.ec2os) {
      sendComponentType = componentAppSyncType.ec2;
    } else if (componentType === eventTypeViaSNS.ec2process) {
      sendComponentType = componentAppSyncType.ec2;
    }

    const UpdatedComponent = await client.graphql({
      query: updatedCompnent,
      variables: {
        input: { component: sendComponentType, state: sendStatusType },
      },
    });
    console.log(componentType);
    console.log(sendComponentType);
    console.log(UpdatedComponent);
  } else if (dynamodbStreamEvent.dynamodb.NewImage.State) {
    const stateType = dynamodbStreamEvent.dynamodb.NewImage.State.S;

    let sendStateType: string = "";

    if (stateType === eventStateViaSNS.ready) {
      sendStateType = gamestateAppSyncType.ready;
    } else if (stateType === eventStateViaSNS.ongoing) {
      sendStateType = gamestateAppSyncType.ongoing;
    } else if (stateType === eventStateViaSNS.resetting) {
      sendStateType = gamestateAppSyncType.resetting;
    }
    const UpdatedGameState = await client.graphql({
      query: updatedGameState,
      variables: { input: { state: sendStateType } },
    });

    console.log(UpdatedGameState);
  }
};
