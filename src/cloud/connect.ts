import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda'
import process from 'node:process'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'

const dynamoDB = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId
  const subdomain = event.queryStringParameters?.subdomain

  if (!subdomain) {
    return {
      statusCode: 400,
      body: 'Subdomain is required',
    }
  }

  try {
    await dynamoDB.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        connectionId: { S: connectionId },
        subdomain: { S: subdomain },
        timestamp: { N: Date.now().toString() },
      },
    }))

    return { statusCode: 200, body: 'Connected' }
  }
  catch (error) {
    console.error('Connection error:', error)
    return { statusCode: 500, body: 'Failed to connect' }
  }
}
