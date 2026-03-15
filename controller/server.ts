/**
 * Caption Push — Bridge Server
 *
 * Responsibilities:
 *  - Serves the built React frontend (production)
 *  - Hosts a WebSocket endpoint for the operator UI
 *  - Holds a ZeroMQ PUB socket that broadcasts to all display Pis
 *
 * Dev:    tsx watch server.ts      (port 3001, WS on same port)
 * Prod:   node server.js           (port 3000, serves React + WS)
 */

import { createServer } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { Publisher } from 'zeromq'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV !== 'production'

const ZMQ_ADDRESS = process.env.ZMQ_ADDRESS ?? 'tcp://*:5555'
const PORT = parseInt(process.env.PORT ?? (isDev ? '3001' : '3000'))

// ---- ZeroMQ publisher ----
const pub = new Publisher()
let seq = 0

async function zmqSend(payload: Record<string, unknown>): Promise<void> {
  await pub.send(JSON.stringify({ ...payload, seq: seq++ }))
}

// ---- HTTP + WebSocket server ----
const app = express()
app.use(express.json())

if (!isDev) {
  // Serve Vite build in production
  const distPath = path.join(__dirname, 'dist')
  app.use(express.static(distPath))
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

wss.on('connection', (ws: WebSocket) => {
  console.log('[bridge] operator connected')

  ws.on('message', async (data) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>
    } catch {
      console.error('[bridge] bad JSON from client')
      return
    }

    try {
      switch (msg.type) {
        case 'show':
          await zmqSend({
            cmd: 'show',
            text: msg.text,
            color: msg.color ?? '#FFFFFF',
            align: msg.align ?? 'center',
          })
          break
        case 'clear':
          await zmqSend({ cmd: 'clear' })
          break
        case 'brightness':
          await zmqSend({ cmd: 'brightness', level: msg.level })
          break
        case 'identify':
          await zmqSend({ cmd: 'identify', ...(msg.id != null ? { id: msg.id } : {}) })
          break
        default:
          console.warn('[bridge] unknown command:', msg.type)
          return
      }

      // Echo ack back to all connected operator clients
      const ack = JSON.stringify({ type: 'ack', cmd: msg.type, seq: seq - 1 })
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(ack)
      }
    } catch (err) {
      console.error('[bridge] ZMQ send error:', err)
      ws.send(JSON.stringify({ type: 'error', message: String(err) }))
    }
  })

  ws.on('close', () => console.log('[bridge] operator disconnected'))
})

async function main(): Promise<void> {
  await pub.bind(ZMQ_ADDRESS)
  console.log(`[bridge] ZeroMQ PUB bound to ${ZMQ_ADDRESS}`)

  httpServer.listen(PORT, () => {
    console.log(`[bridge] HTTP+WS listening on http://localhost:${PORT}`)
    if (isDev) {
      console.log('[bridge] Dev mode — connect Vite at http://localhost:5173')
    }
  })
}

main().catch((err) => {
  console.error('[bridge] fatal:', err)
  process.exit(1)
})
