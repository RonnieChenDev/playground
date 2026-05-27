import { FastifyInstance } from 'fastify'
import db from '../db'

export default async function profileRoutes(app: FastifyInstance) {

  app.get('/api/profile', async () => {
    const profile = await db.profile.findUnique({
      where: { id: 1 }
    })
    return profile ?? {}
  })

  app.put('/api/profile', async (request, reply) => {
    const body = request.body as {
      name?: string
      gender?: string
      weight?: number
      height?: number
      birthYear?: number
      experience?: string
    }

    const profile = await db.profile.upsert({
      where: { id: 1 },
      update: body,
      create: { id: 1, ...body }
    })

    return profile
  })
}