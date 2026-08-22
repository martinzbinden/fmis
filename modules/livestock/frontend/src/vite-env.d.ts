/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.sql?raw' {
  const content: string
  export default content
}

declare module '*.csv?raw' {
  const content: string
  export default content
}
