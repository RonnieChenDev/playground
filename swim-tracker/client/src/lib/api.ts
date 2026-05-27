const BASE_URL = import.meta.env.VITE_API_URL
const API_KEY = import.meta.env.VITE_API_KEY

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
}

export const api = {
  get: (path: string) =>
    fetch(`${BASE_URL}${path}`, { headers }).then(r => r.json()),

  post: (path: string, body: unknown) =>
    fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }).then(r => r.json()),

  put: (path: string, body: unknown) =>
    fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }).then(r => r.json()),

  delete: (path: string) =>
  fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      'x-api-key': API_KEY,
    },
  }),
}