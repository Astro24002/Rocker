export {}

declare global {
  interface Window {
    rocker: {
      app: {
        platform: NodeJS.Platform
      }
    }
  }
}
