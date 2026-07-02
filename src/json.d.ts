// Fallback typing for JSON imports (catalog/catalog.json). If the tsconfig has
// "resolveJsonModule": true (the create-tauri-app default), TypeScript resolves
// the real file and this ambient declaration is simply ignored.
declare module "*.json" {
  const value: unknown;
  export default value;
}
