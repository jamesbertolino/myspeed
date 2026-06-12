export interface TestServer {
  id: string
  name: string
  location: string
  flag: string
  provider: string
  downloadUrl: string
  uploadUrl: string
  pingUrl: string
  cors: boolean
}

export const SERVERS: TestServer[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    location: 'Global (PoP automático)',
    flag: '🌐',
    provider: 'Cloudflare',
    downloadUrl: 'https://speed.cloudflare.com/__down',
    uploadUrl:   'https://speed.cloudflare.com/__up',
    pingUrl:     'https://speed.cloudflare.com/__down?bytes=0',
    cors: true,
  },
  {
    id: 'vultr-saopaulo',
    name: 'Vultr São Paulo',
    location: 'São Paulo, BR',
    flag: '🇧🇷',
    provider: 'Vultr',
    downloadUrl: '/api/speedtest/download?remote=https://sao-paulo-sp-ping.vultr.com/vultr.com.100MB.bin',
    uploadUrl:   'https://speed.cloudflare.com/__up',
    pingUrl:     '/api/speedtest/ping?target=sao-paulo-sp-ping.vultr.com',
    cors: false,
  },
  {
    id: 'vultr-miami',
    name: 'Vultr Miami',
    location: 'Miami, US',
    flag: '🇺🇸',
    provider: 'Vultr',
    downloadUrl: '/api/speedtest/download?remote=https://miami-fl-us-ping.vultr.com/vultr.com.100MB.bin',
    uploadUrl:   'https://speed.cloudflare.com/__up',
    pingUrl:     '/api/speedtest/ping?target=miami-fl-us-ping.vultr.com',
    cors: false,
  },
  {
    id: 'vultr-amsterdam',
    name: 'Vultr Amsterdam',
    location: 'Amsterdam, NL',
    flag: '🇳🇱',
    provider: 'Vultr',
    downloadUrl: '/api/speedtest/download?remote=https://ams-nl-ping.vultr.com/vultr.com.100MB.bin',
    uploadUrl:   'https://speed.cloudflare.com/__up',
    pingUrl:     '/api/speedtest/ping?target=ams-nl-ping.vultr.com',
    cors: false,
  },
  {
    id: 'ovh-rbx',
    name: 'OVH Roubaix',
    location: 'Roubaix, FR',
    flag: '🇫🇷',
    provider: 'OVH',
    downloadUrl: '/api/speedtest/download?remote=https://proof.ovh.net/files/100Mb.dat',
    uploadUrl:   'https://speed.cloudflare.com/__up',
    pingUrl:     '/api/speedtest/ping?target=proof.ovh.net',
    cors: false,
  },
  {
    id: 'hetzner-fsn',
    name: 'Hetzner Nuremberg',
    location: 'Nuremberg, DE',
    flag: '🇩🇪',
    provider: 'Hetzner',
    downloadUrl: '/api/speedtest/download?remote=https://speed.hetzner.de/100MB.bin',
    uploadUrl:   'https://speed.cloudflare.com/__up',
    pingUrl:     '/api/speedtest/ping?target=speed.hetzner.de',
    cors: false,
  },
  {
    id: 'linode-atlanta',
    name: 'Akamai Atlanta',
    location: 'Atlanta, US',
    flag: '🇺🇸',
    provider: 'Akamai',
    downloadUrl: '/api/speedtest/download?remote=https://speedtest.atlanta.linode.com/100MB-atlanta.bin',
    uploadUrl:   'https://speed.cloudflare.com/__up',
    pingUrl:     '/api/speedtest/ping?target=speedtest.atlanta.linode.com',
    cors: false,
  },
  {
    id: 'linode-tokyo',
    name: 'Akamai Tokyo',
    location: 'Tóquio, JP',
    flag: '🇯🇵',
    provider: 'Akamai',
    downloadUrl: '/api/speedtest/download?remote=https://speedtest.tokyo2.linode.com/100MB-tokyo2.bin',
    uploadUrl:   'https://speed.cloudflare.com/__up',
    pingUrl:     '/api/speedtest/ping?target=speedtest.tokyo2.linode.com',
    cors: false,
  },
]
