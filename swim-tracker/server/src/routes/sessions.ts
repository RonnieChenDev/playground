import { FastifyInstance } from 'fastify'
import db from '../db'

export default async function sessionRoutes(app: FastifyInstance) {

  app.get('/api/sessions', async () => {
    const sessions = await db.session.findMany({
      include: {
        groups: {
          include: { sets: true },
          orderBy: { order: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    return sessions
  })

  app.get('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = await db.session.findUnique({
      where: { id: parseInt(id) },
      include: {
        groups: {
          include: { sets: true },
          orderBy: { order: 'asc' }
        }
      }
    })
    if (!session) return reply.code(404).send({ error: 'Not found' })
    return session
  })

  app.post('/api/sessions', async (request, reply) => {
    const body = request.body as {
      date: string
      note?: string
      poolLen: number
      profileWeight?: number
      groups: Array<{
        stroke?: string
        mode: string
        order: number
        sets: Array<{
          dist: number
          time?: string
          rest?: string
          stroke?: string
          order: number
        }>
      }>
    }

    const session = await db.session.create({
      data: {
        date: body.date,
        note: body.note,
        poolLen: body.poolLen,
        groups: {
          create: body.groups.map(g => ({
            stroke: g.stroke,
            mode: g.mode,
            order: g.order,
            sets: {
              create: g.sets.map(s => ({
                dist: s.dist,
                time: s.time,
                rest: s.rest,
                stroke: s.stroke,
                order: s.order,
              }))
            }
          }))
        }
      },
      include: {
        groups: {
          include: { sets: true }
        }
      }
    })

    reply.code(201).send(session)
  })

  app.put('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
        date: string
        note?: string
        poolLen: number
        groups: Array<{
        stroke?: string
        mode: string
        order: number
        sets: Array<{
            dist: number
            time?: string
            rest?: string
            stroke?: string
            mode?: string
            order: number
        }>
        }>
    }

    await db.group.deleteMany({ where: { sessionId: parseInt(id) } })

    const session = await db.session.update({
        where: { id: parseInt(id) },
        data: {
        date: body.date,
        note: body.note,
        poolLen: body.poolLen,
        groups: {
            create: body.groups.map(g => ({
            stroke: g.stroke || null,
            mode: g.mode,
            order: g.order,
            sets: {
                create: g.sets.map(s => ({
                dist: s.dist,
                time: s.time || null,
                rest: s.rest || null,
                stroke: s.stroke || null,
                mode: s.mode || null,
                order: s.order,
                }))
            }
            }))
        }
        },
        include: {
        groups: {
            include: { sets: true },
            orderBy: { order: 'asc' }
        }
        }
    })

    return session
  })

  app.delete('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    await db.session.delete({
      where: { id: parseInt(id) }
    })
    reply.code(204).send()
  })
}