import type { Construct } from 'constructs'
import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs'

export class TunnelStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // DynamoDB table for connection tracking
    const connectionsTable = new dynamodb.Table(this, 'TunnelConnections', {
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change for production
    })

    // Add GSI for subdomain lookup
    connectionsTable.addGlobalSecondaryIndex({
      indexName: 'subdomain-index',
      partitionKey: {
        name: 'subdomain',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    // WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'TunnelWebSocketApi', {
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', new nodeLambda.NodejsFunction(this, 'ConnectHandler', {
          entry: path.join(__dirname, '../lambda/connect.ts'),
          handler: 'handler',
          runtime: lambda.Runtime.NODEJS_18_X,
          environment: {
            TABLE_NAME: connectionsTable.tableName,
          },
        })),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', new nodeLambda.NodejsFunction(this, 'DisconnectHandler', {
          entry: path.join(__dirname, '../lambda/disconnect.ts'),
          handler: 'handler',
          runtime: lambda.Runtime.NODEJS_18_X,
          environment: {
            TABLE_NAME: connectionsTable.tableName,
          },
        })),
      },
    })

    // WebSocket Stage
    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'TunnelWebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    })

    // HTTP API
    const httpApi = new apigatewayv2.HttpApi(this, 'TunnelHttpApi')

    // Lambda for handling HTTP requests
    const httpHandler = new nodeLambda.NodejsFunction(this, 'HttpHandler', {
      entry: path.join(__dirname, '../lambda/http.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      environment: {
        TABLE_NAME: connectionsTable.tableName,
        WEBSOCKET_ENDPOINT: webSocketStage.url,
      },
      timeout: cdk.Duration.seconds(30),
    })

    // Add route to HTTP API
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration('HttpIntegration', httpHandler),
    })

    // Grant DynamoDB permissions
    connectionsTable.grantReadWriteData(httpHandler)

    // Grant permissions to manage WebSocket connections
    httpHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${webSocketStage.stageName}/*`,
      ],
    }))

    // Outputs
    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: webSocketStage.url,
      description: 'WebSocket API URL',
    })

    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: httpApi.url!,
      description: 'HTTP API URL',
    })
  }
}
