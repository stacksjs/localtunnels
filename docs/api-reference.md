# API Reference

## TunnelServer

The main server class that handles incoming connections and manages tunnels.

### Constructor

```typescript
constructor(options: TunnelOptions = {})
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| port | number | 3000 | Port to listen on |
| host | string | '0.0.0.0' | Host to bind to |
| secure | boolean | false | Whether to use secure WebSocket (wss://) |
| verbose | boolean | false | Enable verbose logging |
| localPort | number | 8000 | Local port to forward to |
| localHost | string | 'localhost' | Local host to forward to |
| subdomain | string | '' | Custom subdomain to use |

### Methods

#### start()

```typescript
public async start(): Promise<void>
```

Starts the tunnel server and begins accepting connections.

#### stop()

```typescript
public stop(): void
```

Stops the tunnel server and closes all connections.

## TunnelClient

The client class that connects to the tunnel server and forwards requests.

### Constructor

```typescript
constructor(options: TunnelOptions = {})
```

#### Options

Same as TunnelServer options.

### Methods

#### connect()

```typescript
public async connect(): Promise<void>
```

Connects to the tunnel server and establishes a WebSocket connection.

#### disconnect()

```typescript
public disconnect(): void
```

Disconnects from the tunnel server and closes the WebSocket connection.

## Types

### TunnelOptions

```typescript
interface TunnelOptions {
  port?: number
  host?: string
  secure?: boolean
  verbose?: boolean
  localPort?: number
  localHost?: string
  subdomain?: string
  ssl?: {
    key: string
    cert: string
    ca?: string
  }
}
```

### TunnelConnection

```typescript
interface TunnelConnection {
  id: string
  clientSocket: Socket | TLSSocket
  tunnels: Map<string, Socket>
}
```

### TunnelRequest

```typescript
interface TunnelRequest {
  id: string
  method: string
  url: string
  headers: Record<string, string>
  body?: Uint8Array
}
```

## WebSocket Protocol

The tunnel uses a WebSocket-based protocol for communication between client and server.

### Message Types

#### Client to Server

- `ready`: Sent when client is ready to accept connections

  ```typescript
  {
    type: 'ready',
    subdomain: string
  }
  ```

- `response`: Sent in response to a request

  ```typescript
  {
    type: 'response',
    id: string,
    status: number,
    headers: Record<string, string>,
    body: string
  }
  ```

#### Server to Client

- `connected`: Sent when WebSocket connection is established

  ```typescript
  {
    type: 'connected'
  }
  ```

- `request`: Sent when a new HTTP request is received

  ```typescript
  {
    type: 'request',
    id: string,
    method: string,
    url: string,
    headers: Record<string, string>
  }
  ```
