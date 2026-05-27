import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import profileRoutes from './routes/profile'
import sessionRoutes from './routes/sessions'

dotenv.config()

const app = Fastify({ logger: true })

app.register(cors, {
  origin: 'http://localhost:5173',
  allowedHeaders: ['Content-Type', 'x-api-key'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
})

app.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS') return
  const apiKey = request.headers['x-api-key']
  if (apiKey !== process.env.API_KEY) {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

app.register(profileRoutes)
app.register(sessionRoutes)

app.get('/health', async () => {
  return { status: 'ok' }
})

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()