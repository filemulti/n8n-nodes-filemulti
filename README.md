# n8n-nodes-filemulti

An [n8n](https://n8n.io) community node for [FileMulti](https://filemulti.com): convert, compress
and recognise files with FileMulti tools as a step of a workflow.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation and install the package `n8n-nodes-filemulti`.

## Credentials

The node signs in to FileMulti over OAuth2; no API key is copied anywhere.

1. In n8n, create a credential of the type **FileMulti OAuth2 API**.
2. Keep **API URL** at `https://filemulti.com`.
3. Click **Connect my account**, sign in to FileMulti and allow the access.

Runs spend the credits of the connected FileMulti account, the same credits as on the site.
Credits are bought on [filemulti.com](https://filemulti.com); the node sells nothing itself.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Tool | Search | Finds the tools that fit a task or a file format |
| Tool | Get | Reads what one tool accepts, returns and costs |
| File | Upload | Hands a binary field of the item over so that a tool can run on it |
| File | Import From URL | Hands a file over by its public https link |
| Run | Start | Runs one tool on files or text and waits for its result |
| Run | Get | Reads how a run ended, what it cost and where its result is |
| Credit | Get Balance | Reads how many credits the connected account can spend |

**Run → Start** loads the arguments of the chosen tool from FileMulti itself: pick a tool and
the fields it takes appear below. A file argument takes the name of a binary field of the item,
a public https link, or the ID of a file uploaded before. **Spend At Most** refuses a run that
would cost more credits than the limit, and nothing is charged then. A run that outlives
**Wait (Seconds)** is returned while still running; read it later with **Run → Get**.

## Example workflow

1. **HTTP Request** downloads an image into the binary field `data` of the item.
2. **FileMulti**, Resource **Run**, Operation **Start**, Tool **image_compress**, its file
   argument set to `data`.
3. The compressed image comes out in the binary field `data` of the item.

## Compatibility

Built and tested against n8n 2.16 with the n8n nodes API version 1.

## Resources

- [FileMulti](https://filemulti.com) · [Terms of use](https://filemulti.com/en/terms) ·
  [Privacy policy](https://filemulti.com/en/privacy)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Development

This repository is published from the FileMulti source tree; `vendor/client` is the FileMulti
API client compiled into one module, bundled into the node at build time. `npm ci` then
`npm run build` builds the package into `dist`; `npm run lint` runs the n8n node linter.

## License

[MIT](LICENSE)
