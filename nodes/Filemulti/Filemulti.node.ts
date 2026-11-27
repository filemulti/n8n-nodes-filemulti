import {
  bodyOf,
  fieldsOf,
  refusalOfRun,
  resultFileId,
  type ToolField,
  type ToolJobSubmitBodyWritable,
  text,
} from '@convertator/client'
import {
  type FieldType,
  type IExecuteFunctions,
  type ILoadOptionsFunctions,
  type INodeExecutionData,
  type INodeListSearchResult,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
  type ResourceMapperFields,
} from 'n8n-workflow'

import { CREDENTIAL_NAME } from '../../credentials/FileMultiOAuth2Api.credentials'
import { asNodeError, n8nApi } from './shared/transport'

const LINK = /^https?:\/\//i
const SHOW_START = { show: { resource: ['run'], operation: ['start'] } }

const MAPPED: Record<ToolField['kind'], FieldType> = {
  file: 'string',
  files: 'array',
  text: 'string',
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
  choice: 'options',
  json: 'string',
}

const titled = (name: string) =>
  name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export class Filemulti implements INodeType {
  methods = {
    listSearch: {
      async searchTools(
        this: ILoadOptionsFunctions,
        filter?: string,
        paginationToken?: string,
      ): Promise<INodeListSearchResult> {
        const api = await n8nApi(this)
        const page = await api.searchToolsPage({
          q: filter || undefined,
          limit: 20,
          cursor: paginationToken || undefined,
        })
        return {
          paginationToken: page.nextCursor,
          results: page.tools.map((card) => ({
            name: card.title,
            value: card.tool,
            description: card.summary,
          })),
        }
      },
    },
    // WHY: the arguments are the schema the server answers for the chosen tool; nothing about
    // a tool is written into the node.
    resourceMapping: {
      async toolArguments(
        this: ILoadOptionsFunctions,
      ): Promise<ResourceMapperFields> {
        const tool = this.getNodeParameter('tool', undefined, {
          extractValue: true,
        }) as string
        if (!tool) return { fields: [] }
        const api = await n8nApi(this)
        return {
          fields: fieldsOf(await api.describeTool(tool)).map((field) => ({
            id: field.name,
            displayName: titled(field.name),
            required: field.required,
            defaultMatch: false,
            display: true,
            type: MAPPED[field.kind],
            options: field.choices?.map((choice) => ({
              name: choice,
              value: choice,
            })),
          })),
        }
      },
    },
  }

  description: INodeTypeDescription = {
    displayName: 'FileMulti',
    name: 'filemulti',
    icon: {
      light: 'file:../../icons/filemulti.svg',
      dark: 'file:../../icons/filemulti.dark.svg',
    },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: text('en', 'channel-listing-n8n-description'),
    defaults: { name: 'FileMulti' },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: CREDENTIAL_NAME, required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Credit', value: 'credit' },
          { name: 'File', value: 'file' },
          { name: 'Run', value: 'run' },
          { name: 'Tool', value: 'tool' },
        ],
        default: 'file',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['credit'] } },
        options: [
          {
            name: 'Get Balance',
            value: 'getBalance',
            description:
              'Read how many credits the connected account can spend',
            action: 'Get the credit balance',
          },
        ],
        default: 'getBalance',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['file'] } },
        options: [
          {
            name: 'Import From URL',
            value: 'import',
            description:
              'Hand a file over by its link: the service fetches it itself',
            action: 'Import a file from a URL',
          },
          {
            name: 'Upload',
            value: 'upload',
            description: 'Hand a binary file over so that a tool can run on it',
            action: 'Upload a file',
          },
        ],
        default: 'upload',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['run'] } },
        options: [
          {
            name: 'Get',
            value: 'get',
            description:
              'Read how a run ended, what it cost and where its result is',
            action: 'Get a run',
          },
          {
            name: 'Start',
            value: 'start',
            description:
              'Run one tool on files or text and wait for its result',
            action: 'Start a run',
          },
        ],
        default: 'start',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['tool'] } },
        options: [
          {
            name: 'Get',
            value: 'get',
            description: 'Read what one tool accepts, returns and costs',
            action: 'Get a tool',
          },
          {
            name: 'Search',
            value: 'search',
            description: 'Find the tools that fit a task or a file format',
            action: 'Search tools',
          },
        ],
        default: 'search',
      },
      {
        displayName: 'Input Binary Field',
        name: 'binaryPropertyName',
        type: 'string',
        default: 'data',
        required: true,
        displayOptions: { show: { resource: ['file'], operation: ['upload'] } },
        hint: 'The name of the input binary field containing the file to upload',
      },
      {
        displayName: 'File URL',
        name: 'fileUrl',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['file'], operation: ['import'] } },
        description: 'A public https link to the file',
      },
      {
        displayName: 'File Name',
        name: 'fileName',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['file'], operation: ['import'] } },
        description: 'The name to keep the file under, with its extension',
      },
      {
        displayName: 'Tool',
        name: 'tool',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        displayOptions: SHOW_START,
        modes: [
          {
            displayName: 'From List',
            name: 'list',
            type: 'list',
            typeOptions: { searchListMethod: 'searchTools', searchable: true },
          },
          {
            displayName: 'By Name',
            name: 'id',
            type: 'string',
            placeholder: 'e.g. image_compress',
          },
        ],
      },
      {
        displayName: 'Arguments',
        name: 'arguments',
        type: 'resourceMapper',
        noDataExpression: true,
        default: { mappingMode: 'defineBelow', value: null },
        required: true,
        displayOptions: SHOW_START,
        description:
          'A file argument takes the name of a binary field of the item, a public https link, or the ID of a file uploaded before',
        typeOptions: {
          loadOptionsDependsOn: ['tool.value'],
          resourceMapper: {
            resourceMapperMethod: 'toolArguments',
            mode: 'add',
            fieldWords: { singular: 'argument', plural: 'arguments' },
            addAllFields: true,
            multiKeyMatch: false,
            supportAutoMap: false,
          },
        },
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add option',
        default: {},
        displayOptions: SHOW_START,
        options: [
          {
            displayName: 'Download Result',
            name: 'download',
            type: 'boolean',
            default: true,
            description:
              'Whether to put a file the run returns into the binary field "data" of the item',
          },
          {
            displayName: 'Spend At Most',
            name: 'maxCredits',
            type: 'number',
            typeOptions: { minValue: 0, numberPrecision: 1 },
            default: 0,
            description:
              'The run is refused, and nothing is charged, when it would cost more credits than this; 0 sets no limit',
          },
          {
            displayName: 'Wait (Seconds)',
            name: 'waitSeconds',
            type: 'number',
            default: 300,
            description:
              'How long to wait for a long run; one that outlives it is returned while still running, to be read later with Run → Get',
          },
        ],
      },
      {
        displayName: 'Run ID',
        name: 'runId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['run'], operation: ['get'] } },
        description: 'The ID a run was started with',
      },
      {
        displayName: 'Download Result',
        name: 'downloadResult',
        type: 'boolean',
        default: true,
        displayOptions: { show: { resource: ['run'], operation: ['get'] } },
        description:
          'Whether to put the file of a finished run into the binary data of the item',
      },
      {
        displayName: 'Tool Name',
        name: 'toolName',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['tool'], operation: ['get'] } },
        description:
          'The name a tool search returned, for example image_compress',
      },
      {
        displayName: 'Task',
        name: 'query',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['tool'], operation: ['search'] } },
        description:
          'What to do and to what, for example "compress image" or "pdf to word"',
      },
      {
        displayName: 'Input Format',
        name: 'inputFormat',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['tool'], operation: ['search'] } },
        description:
          'Only tools that read this format: a short name such as png, or a media type',
      },
      {
        displayName: 'Output Format',
        name: 'outputFormat',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['tool'], operation: ['search'] } },
        description: 'Only tools that can write this format, for example pdf',
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const api = await n8nApi(this)
    const out: INodeExecutionData[] = []
    const items = this.getInputData()
    // WHY: the run is paid for by now; a download that fails must not fail the item, or a
    // retry of the node would start and charge the tool again.
    const withFile = async (
      run: Parameters<typeof resultFileId>[0],
      item: number,
    ): Promise<INodeExecutionData> => {
      const fileId = resultFileId(run)
      if (fileId === undefined) return { json: run, pairedItem: { item } }
      try {
        const file = await api.downloadFile(fileId)
        const data = await this.helpers.prepareBinaryData(
          Buffer.from(await file.data.arrayBuffer()),
          file.name,
          file.contentType,
        )
        return { json: run, binary: { data }, pairedItem: { item } }
      } catch (error) {
        return {
          json: { ...run, download_error: (error as Error).message },
          pairedItem: { item },
        }
      }
    }
    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string
        const operation = this.getNodeParameter('operation', i) as string
        let json: object
        if (resource === 'tool' && operation === 'search') {
          const given = (name: string) =>
            (this.getNodeParameter(name, i, '') as string) || undefined
          const cards = await api.searchTools({
            q: given('query'),
            input: given('inputFormat'),
            output: given('outputFormat'),
          })
          for (const card of cards) {
            out.push({ json: { ...card }, pairedItem: { item: i } })
          }
          continue
        }
        if (resource === 'tool' && operation === 'get') {
          json = await api.describeTool(
            this.getNodeParameter('toolName', i) as string,
          )
        } else if (resource === 'credit' && operation === 'getBalance') {
          json = await api.balance()
        } else if (resource === 'run' && operation === 'start') {
          const tool = this.getNodeParameter('tool', i, '', {
            extractValue: true,
          }) as string
          const given = (this.getNodeParameter('arguments.value', i, {}) ??
            {}) as Record<string, unknown>
          const options = this.getNodeParameter('options', i, {}) as {
            download?: boolean
            maxCredits?: number
            waitSeconds?: number
          }
          const fields = fieldsOf(await api.describeTool(tool))
          // WHY: a file reaches a node three ways — as binary data of the item, as a link the
          // server fetches itself, or as the id of a file handed over before.
          const held = async (value: unknown) => {
            if (typeof value !== 'string' || value === '') return value
            if (LINK.test(value))
              return (await api.importFile({ url: value })).id
            if (items[i]?.binary?.[value] === undefined) return value
            const meta = this.helpers.assertBinaryData(i, value)
            const bytes = await this.helpers.getBinaryDataBuffer(i, value)
            const kept = await api.uploadFile({
              data: new Blob([new Uint8Array(bytes)], { type: meta.mimeType }),
              name: meta.fileName ?? value,
            })
            return kept.id
          }
          const values: Record<string, unknown> = { ...given }
          for (const field of fields) {
            const value = values[field.name]
            if (field.kind === 'file') values[field.name] = await held(value)
            if (field.kind === 'files' && Array.isArray(value)) {
              const ids: unknown[] = []
              for (const one of value) ids.push(await held(one))
              values[field.name] = ids
            }
          }
          const outcome = await api.runTool(
            bodyOf(tool, fields, values) as ToolJobSubmitBodyWritable,
            {
              ceilingMs: (options.waitSeconds ?? 300) * 1000,
              maxCredits: options.maxCredits || undefined,
            },
          )
          if (outcome.state === 'pending') {
            out.push({
              json: { ...outcome.run, id: outcome.runId, status: 'running' },
              pairedItem: { item: i },
            })
            continue
          }
          const failure = refusalOfRun(outcome.run)
          if (failure !== undefined) throw failure
          if (options.download !== false) {
            out.push(await withFile(outcome.run, i))
            continue
          }
          json = outcome.run
        } else if (resource === 'run' && operation === 'get') {
          // WHY: a run that was not waited for is read here once it is over, and this is then
          // the node its file comes from.
          const read = await api.readRun(
            this.getNodeParameter('runId', i) as string,
          )
          if (this.getNodeParameter('downloadResult', i, true) !== false) {
            out.push(await withFile(read, i))
            continue
          }
          json = read
        } else if (resource === 'file' && operation === 'import') {
          json = await api.importFile({
            url: this.getNodeParameter('fileUrl', i) as string,
            name:
              (this.getNodeParameter('fileName', i, '') as string) || undefined,
          })
        } else if (resource === 'file' && operation === 'upload') {
          const field = this.getNodeParameter('binaryPropertyName', i) as string
          const meta = this.helpers.assertBinaryData(i, field)
          const bytes = await this.helpers.getBinaryDataBuffer(i, field)
          json = await api.uploadFile({
            data: new Blob([new Uint8Array(bytes)], { type: meta.mimeType }),
            name: meta.fileName ?? field,
          })
        } else {
          throw new NodeOperationError(
            this.getNode(),
            `The operation "${operation}" is not supported for the resource "${resource}"`,
            { itemIndex: i },
          )
        }
        out.push({ json: { ...json }, pairedItem: { item: i } })
      } catch (error) {
        const shown = asNodeError(this.getNode(), error, i)
        if (!this.continueOnFail()) throw shown
        out.push({ json: { error: shown.message }, pairedItem: { item: i } })
      }
    }
    return [out]
  }
}
