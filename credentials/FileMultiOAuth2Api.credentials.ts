import type { ICredentialType, Icon, INodeProperties } from 'n8n-workflow'

export const CREDENTIAL_NAME = 'fileMultiOAuth2Api'

export class FileMultiOAuth2Api implements ICredentialType {
  name = CREDENTIAL_NAME

  extends = ['oAuth2Api']

  displayName = 'FileMulti OAuth2 API'

  icon: Icon = {
    light: 'file:../icons/filemulti.svg',
    dark: 'file:../icons/filemulti.dark.svg',
  }

  documentationUrl = `${__CONVERTATOR_API_URL__}/developers`

  properties: INodeProperties[] = [
    {
      displayName: 'API URL',
      name: 'baseUrl',
      type: 'string',
      default: __CONVERTATOR_API_URL__,
      required: true,
      description: 'Change it only to work against a test stand of the product',
    },
    {
      displayName: 'Grant Type',
      name: 'grantType',
      type: 'hidden',
      default: 'pkce',
    },
    {
      displayName: 'Authorization URL',
      name: 'authUrl',
      type: 'hidden',
      default: '={{$self["baseUrl"]}}/oauth/authorize',
      required: true,
    },
    {
      displayName: 'Access Token URL',
      name: 'accessTokenUrl',
      type: 'hidden',
      default: '={{$self["baseUrl"]}}/oauth/token',
      required: true,
    },
    {
      displayName: 'Client Secret',
      name: 'clientSecret',
      type: 'hidden',
      typeOptions: { password: true },
      default: '',
    },
    {
      displayName: 'Scope',
      name: 'scope',
      type: 'hidden',
      default: 'read write',
    },
    {
      displayName: 'Auth URI Query Parameters',
      name: 'authQueryParameters',
      type: 'hidden',
      default:
        '={{"resource=" + encodeURIComponent($self["baseUrl"] + "/api/v1")}}',
    },
    {
      displayName: 'Authentication',
      name: 'authentication',
      type: 'hidden',
      default: 'body',
    },
  ]
}
