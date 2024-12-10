import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda'
import process from 'node:process'
import { DeleteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'

const dynamoDB = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId

  try {
    await dynamoDB.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: {
        connectionId: { S: connectionId },
      },
    }))

    return { statusCode: 200, body: 'Disconnected' }
  }
  catch (error) {
    console.error('Disconnection error:', error)
    return { statusCode: 500, body: 'Failed to disconnect' }
  }
}
