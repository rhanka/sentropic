import { writeFileSync } from 'node:fs';

const openapiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'Top AI Ideas API',
    version: '0.1.0'
  },
  paths: {
    '/api/v1/chat/sessions': {
      get: {
        summary: 'Lister les sessions de chat de l’utilisateur',
        responses: {
          200: {
            description: 'OK'
          }
        }
      }
    },
    '/api/v1/chat/sessions/{id}/messages': {
      get: {
        summary: 'Lister les messages d’une session de chat',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'OK'
          }
        }
      }
    },
    '/api/v1/chat/messages': {
      post: {
        summary: 'Créer un message user et déclencher la réponse assistant (job queue chat_message)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  content: { type: 'string' },
                  model: { type: 'string' },
                  primaryContextType: { type: 'string', enum: ['company', 'folder', 'usecase', 'executive_summary'] },
                  primaryContextId: { type: 'string' },
                  sessionTitle: { type: 'string' }
                },
                required: ['content']
              }
            }
          }
        },
        responses: {
          200: {
            description: 'OK'
          }
        }
      }
    }
  }
};

writeFileSync('openapi.json', JSON.stringify(openapiDoc, null, 2));
