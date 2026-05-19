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
import { request as httpRequest } from 'http'
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

// Proxy MJPEG preview stream from display1 to the operator browser
const PREVIEW_HOST = process.env.PREVIEW_HOST ?? 'display1'
const PREVIEW_PORT = parseInt(process.env.PREVIEW_PORT ?? '7777')

// Proxy MJPEG stream from display1 — browser receives frames as fast as the daemon pushes them
app.get('/preview/stream', (_req, res) => {
  const proxy = httpRequest(
    { hostname: PREVIEW_HOST, port: PREVIEW_PORT, path: '/stream', method: 'GET' },
    (upstream) => {
      res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
      res.setHeader('Cache-Control', 'no-store')
      upstream.pipe(res)
    },
  )
  proxy.on('error', () => { if (!res.headersSent) res.status(503).end() })
  proxy.end()
})

// Proxy a single JPEG snapshot (kept for backwards compat)
app.get('/preview/frame', (_req, res) => {
  const proxy = httpRequest(
    { hostname: PREVIEW_HOST, port: PREVIEW_PORT, path: '/frame', method: 'GET' },
    (upstream) => {
      if (upstream.statusCode === 204) { res.status(204).end(); return }
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', 'no-store')
      upstream.pipe(res)
    },
  )
  proxy.on('error', () => { if (!res.headersSent) res.status(503).end() })
  proxy.end()
})

// Serve LiberationSans font so SimDisplay canvas can match the display renderer
app.use('/fonts', express.static('/usr/share/fonts/truetype/liberation'))

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
            color: msg.color ?? '#DCDCD2',
            align: msg.align ?? 'left',
            hold: msg.hold ?? false,
          })
          break
        case 'preload':
          await zmqSend({
            cmd: 'preload',
            text: msg.text,
            color: msg.color ?? '#DCDCD2',
            align: msg.align ?? 'left',
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
