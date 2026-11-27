// WHY: the address of the product the package is built for is a build parameter the bundler
// substitutes; a verified node may not read the environment of the n8n process.
declare const __CONVERTATOR_API_URL__: string
