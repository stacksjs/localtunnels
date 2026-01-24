/**
 * Lambda handler for WebSocket $disconnect route
 * This is deployed to AWS Lambda and uses the AWS SDK v3
 */

export async function handler(event: any): Promise<any> {
  const { DynamoDBClient, DeleteItemCommand, GetItemCommand } = await import('@aws-sdk/client-dynamodb')

  const dynamodb = new DynamoDBClient({})
  const TABLE_NAME = process.env.TABLE_NAME!

  const connectionId = event.requestContext?.connectionId

  try {
    // First, get the connection to log what subdomain is being released
    const existing = await dynamodb.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        connectionId: { S: connectionId },
      },
    }))

    const subdomain = existing.Item?.subdomain?.S

    // Delete the connection record
    await dynamodb.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: {
        connectionId: { S: connectionId },
      },
    }))

    console.log(`Connection closed: ${connectionId}${subdomain ? ` (subdomain: ${subdomain})` : ''}`)

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Disconnected',
        connectionId,
        subdomain: subdomain || null,
      }),
    }
  }
  catch (error) {
    console.error('Disconnection error:', error)

    // Still try to delete even if getting the record failed
    try {
      const { DeleteItemCommand: DeleteCmd } = await import('@aws-sdk/client-dynamodb')
      await dynamodb.send(new DeleteCmd({
        TableName: TABLE_NAME,
        Key: {
          connectionId: { S: connectionId },
        },
      }))
    }
    catch {
      // Ignore secondary errors
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Disconnection error',
        message: 'An error occurred during disconnection, but the connection was likely cleaned up',
      }),
    }
  }
}
