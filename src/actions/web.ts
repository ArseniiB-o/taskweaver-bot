import type { Action } from './types.js';
import { escPath } from '../utils.js';

export const webActions: Action[] = [
  {
    id: 'web.screenshot',
    category: 'web',
    name: 'Screenshot URL',
    description: 'Take a screenshot of a webpage using wkhtmltoimage',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to screenshot' },
      { name: 'width', type: 'number', required: false, description: 'Viewport width in pixels', default: 1280 },
    ],
    async execute(params, ctx) {
      try {
        const url = params.url as string;
        const width = (params.width as number) ?? 1280;
        const outFile = ctx.outputPath('screenshot.png');
        await ctx.exec(
          'wkhtmltoimage --width ' + width + ' "' + url + '" "' + escPath(outFile) + '"',
          30000,
        );
        return { files: [outFile] };
      } catch (err: any) {
        return { error: 'Screenshot failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.status_check',
    category: 'web',
    name: 'Check Website Status',
    description: 'Check if a website is up and return status code with headers',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to check' },
    ],
    async execute(params, ctx) {
      try {
        const url = params.url as string;
        const status = await ctx.exec('curl -s -o /dev/null -w "%{http_code} %{time_total}s" "' + url + '"', 15000);
        const headers = await ctx.exec('curl -s -I "' + url + '"', 15000);
        return { text: 'Status: ' + status + '\n\nHeaders:\n' + headers };
      } catch (err: any) {
        return { error: 'Status check failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.dns_lookup',
    category: 'web',
    name: 'DNS Lookup',
    description: 'Perform a DNS lookup for a domain',
    params: [
      { name: 'domain', type: 'string', required: true, description: 'Domain to look up' },
    ],
    async execute(params, ctx) {
      try {
        const domain = params.domain as string;
        let result: string;
        try {
          result = await ctx.exec('dig "' + domain + '"', 15000);
        } catch {
          result = await ctx.exec('nslookup "' + domain + '"', 15000);
        }
        return { text: result };
      } catch (err: any) {
        return { error: 'DNS lookup failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.whois',
    category: 'web',
    name: 'WHOIS Lookup',
    description: 'Perform a WHOIS lookup for a domain',
    params: [
      { name: 'domain', type: 'string', required: true, description: 'Domain to look up' },
    ],
    async execute(params, ctx) {
      try {
        const result = await ctx.exec('whois "' + (params.domain as string) + '"', 30000);
        return { text: result };
      } catch (err: any) {
        return { error: 'WHOIS lookup failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.download',
    category: 'web',
    name: 'Download File',
    description: 'Download a file from a URL',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to download' },
    ],
    async execute(params, ctx) {
      try {
        const url = params.url as string;
        const filename = url.split('/').pop()?.split('?')[0] || 'downloaded_file';
        const outFile = ctx.outputPath(filename);
        await ctx.exec('curl -L -o "' + escPath(outFile) + '" "' + url + '"', 60000);
        return { files: [outFile] };
      } catch (err: any) {
        return { error: 'Download failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.headers',
    category: 'web',
    name: 'Show HTTP Headers',
    description: 'Show HTTP response headers for a URL',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to check headers for' },
    ],
    async execute(params, ctx) {
      try {
        const result = await ctx.exec('curl -s -I "' + (params.url as string) + '"', 15000);
        return { text: result };
      } catch (err: any) {
        return { error: 'Headers check failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.ssl_check',
    category: 'web',
    name: 'Check SSL Certificate',
    description: 'Check the SSL certificate for a domain',
    params: [
      { name: 'domain', type: 'string', required: true, description: 'Domain to check SSL for' },
    ],
    async execute(params, ctx) {
      try {
        const domain = params.domain as string;
        const result = await ctx.exec(
          'echo "" | openssl s_client -connect "' + domain + ':443" -servername "' + domain + '" 2>&1 | openssl x509 -noout -text 2>&1',
          20000,
        );
        return { text: result };
      } catch (err: any) {
        return { error: 'SSL check failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.ping',
    category: 'web',
    name: 'Ping Host',
    description: 'Ping a host 4 times and return results',
    params: [
      { name: 'host', type: 'string', required: true, description: 'Host to ping' },
    ],
    async execute(params, ctx) {
      try {
        const result = await ctx.exec('ping -c 4 "' + (params.host as string) + '"', 20000);
        return { text: result };
      } catch (err: any) {
        return { error: 'Ping failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.curl',
    category: 'web',
    name: 'Custom HTTP Request',
    description: 'Make a custom HTTP request with curl',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to request' },
      {
        name: 'method',
        type: 'string',
        required: false,
        description: 'HTTP method',
        enum: ['GET', 'POST', 'PUT', 'DELETE'],
        default: 'GET',
      },
      { name: 'data', type: 'string', required: false, description: 'Request body data' },
    ],
    async execute(params, ctx) {
      try {
        const method = (params.method as string) ?? 'GET';
        const url = params.url as string;
        const dataFlag = params.data
          ? ' --data-raw "' + (params.data as string).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
          : '';
        const result = await ctx.exec('curl -s -X ' + method + dataFlag + ' "' + url + '"', 30000);
        return { text: result };
      } catch (err: any) {
        return { error: 'HTTP request failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.ip_lookup',
    category: 'web',
    name: 'IP Geolocation',
    description: 'Look up geolocation information for an IP address',
    params: [
      { name: 'ip', type: 'string', required: true, description: 'IP address to look up' },
    ],
    async execute(params, ctx) {
      try {
        const result = await ctx.exec('curl -s "http://ip-api.com/json/' + (params.ip as string) + '"', 15000);
        try {
          const parsed = JSON.parse(result);
          const lines = Object.entries(parsed).map(([k, v]) => k + ': ' + v).join('\n');
          return { text: lines };
        } catch {
          return { text: result };
        }
      } catch (err: any) {
        return { error: 'IP lookup failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.url_encode',
    category: 'web',
    name: 'URL Encode',
    description: 'URL-encode a string',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text to encode' },
    ],
    async execute(params, _ctx) {
      try {
        return { text: encodeURIComponent(params.text as string) };
      } catch (err: any) {
        return { error: 'URL encode failed: ' + err.message };
      }
    },
  },

  {
    id: 'web.url_decode',
    category: 'web',
    name: 'URL Decode',
    description: 'URL-decode a string',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text to decode' },
    ],
    async execute(params, _ctx) {
      try {
        return { text: decodeURIComponent(params.text as string) };
      } catch (err: any) {
        return { error: 'URL decode failed: ' + err.message };
      }
    },
  },
];
