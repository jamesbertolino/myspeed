// OUI prefix (first 3 bytes, lowercase no-sep) → vendor name
const OUI: Record<string, string> = {
  // Apple
  '000393': 'Apple', '000502': 'Apple', '3c0754': 'Apple',
  'acbc32': 'Apple', 'f4f15a': 'Apple', 'a8be27': 'Apple', '8c8590': 'Apple',
  'd4619d': 'Apple', '7cd1c3': 'Apple', '60f819': 'Apple', 'b8e856': 'Apple',
  // Samsung
  '001632': 'Samsung', '002454': 'Samsung', '00266f': 'Samsung', '001efe': 'Samsung',
  '84a466': 'Samsung', 'f4425a': 'Samsung', 'e8039a': 'Samsung', '6c2f2c': 'Samsung',
  // Xiaomi
  'f48b32': 'Xiaomi', '28e31f': 'Xiaomi', '5c4ca9': 'Xiaomi', '0016e3': 'Xiaomi',
  '74510b': 'Xiaomi', '642737': 'Xiaomi', 'fc64ba': 'Xiaomi', '34ce00': 'Xiaomi',
  // TP-Link
  '000aeb': 'TP-Link', '001d0f': 'TP-Link', '14cc20': 'TP-Link', '1c61b4': 'TP-Link',
  '50c7bf': 'TP-Link', '7c8bca': 'TP-Link', '9c5316': 'TP-Link', 'ac84c6': 'TP-Link',
  'b0be76': 'TP-Link', 'e8de27': 'TP-Link', 'f4f26d': 'TP-Link', 'c46e1f': 'TP-Link',
  // D-Link
  '001195': 'D-Link', '00179a': 'D-Link', '001cf0': 'D-Link', '00265a': 'D-Link',
  '1caff7': 'D-Link', '28107b': 'D-Link', '340804': 'D-Link', 'c8be19': 'D-Link',
  // Intelbras
  '009011': 'Intelbras', '84c9b2': 'Intelbras', 'b0a7b9': 'Intelbras',
  '4887fc': 'Intelbras', 'c49f4c': 'Intelbras',
  // Ubiquiti
  '0418d6': 'Ubiquiti', '04180f': 'Ubiquiti', '24a43c': 'Ubiquiti', '44d9e7': 'Ubiquiti',
  '68d79a': 'Ubiquiti', '78451c': 'Ubiquiti', 'b4fbe4': 'Ubiquiti', 'dc9fdb': 'Ubiquiti',
  // MikroTik
  '000c42': 'MikroTik', '2cc8e9': 'MikroTik', '4c5e0c': 'MikroTik', '6c3b6b': 'MikroTik',
  '744d28': 'MikroTik', 'b8690a': 'MikroTik', 'cc2de0': 'MikroTik', 'd4ca6d': 'MikroTik',
  'e48d8c': 'MikroTik',
  // Cisco
  '000142': 'Cisco', '000164': 'Cisco', '0001c9': 'Cisco', '00022d': 'Cisco',
  '0004dd': 'Cisco', '000e83': 'Cisco', '001601': 'Cisco', '001e7a': 'Cisco',
  '0050f0': 'Cisco', '2c3124': 'Cisco', '6c0e0d': 'Cisco', 'a89306': 'Cisco',
  // Huawei
  '000e5e': 'Huawei', '001e67': 'Huawei', '002568': 'Huawei', '009048': 'Huawei',
  '047975': 'Huawei', '1c8e5c': 'Huawei', '286ed4': 'Huawei', '2c9d65': 'Huawei',
  '4c1fcc': 'Huawei', '5c4cca': 'Huawei', '6c4b90': 'Huawei',
  '8c34fd': 'Huawei', '9ce374': 'Huawei', 'b4430d': 'Huawei',
  // Motorola
  '000bf5': 'Motorola', '0015e9': 'Motorola', '00216b': 'Motorola', '40786a': 'Motorola',
  // Dell
  '0012f0': 'Dell', '001422': 'Dell', '001a4b': 'Dell', '001e4f': 'Dell',
  '002564': 'Dell', 'b083fe': 'Dell', 'f0761c': 'Dell',
  // Intel
  '001111': 'Intel', '001b21': 'Intel', '0021d8': 'Intel', '002622': 'Intel',
  '0040f6': 'Intel', '40a5ef': 'Intel', '5cf370': 'Intel', '6038e0': 'Intel',
  '7c7a91': 'Intel', 'a4c494': 'Intel',
  // Amazon (Echo, Fire TV, etc)
  '0c5415': 'Amazon', '1073e3': 'Amazon', '34d270': 'Amazon', '40b496': 'Amazon',
  '44650d': 'Amazon', '680571': 'Amazon', 'f0272d': 'Amazon', 'fc65de': 'Amazon',
  // Google (Chromecast, Nest, etc)
  '1c1ac0': 'Google', '3413e8': 'Google', '54604a': 'Google', '6c40c6': 'Google',
  'a4770a': 'Google', 'f4f5e8': 'Google',
  // Raspberry Pi
  'b827eb': 'Raspberry Pi', 'e45f01': 'Raspberry Pi',
  // HP
  '00145e': 'HP', '001560': 'HP', '001b78': 'HP',
  '0021b7': 'HP', 'f44d30': 'HP', 'b4b52f': 'HP',
  // Nintendo
  '000999': 'Nintendo', '002709': 'Nintendo', '0009bf': 'Nintendo',
  '7cf359': 'Nintendo', 'e00c7f': 'Nintendo',
  // Sony
  '00013a': 'Sony', '001d0d': 'Sony', '001fa7': 'Sony',
  '002248': 'Sony', '0024be': 'Sony', '005075': 'Sony', '70d93c': 'Sony',
  // LG
  '001e75': 'LG', '002483': 'LG', '0025a0': 'LG', 'a81b5a': 'LG', 'cc2d83': 'LG',
  // Epson
  '0026ab': 'Epson', '0004ac': 'Epson',
  // Canon
  '000085': 'Canon',
}

export function lookupVendor(mac: string): string {
  if (!mac) return ''
  const normalized = mac.toLowerCase().replace(/[^0-9a-f]/g, '')
  if (normalized.length < 6) return ''
  const prefix = normalized.slice(0, 6)
  return OUI[prefix] ?? ''
}

// Guess device type from open ports
export function guessDeviceType(openPorts: number[]): string {
  const ports = new Set(openPorts)
  if (ports.has(554) || ports.has(8554)) return 'Câmera IP'
  if (ports.has(9100) || ports.has(515) || ports.has(631)) return 'Impressora'
  if (ports.has(22) && (ports.has(80) || ports.has(443))) return 'Servidor'
  if (ports.has(22) && ports.size <= 3) return 'Servidor SSH'
  if (ports.has(53) && (ports.has(80) || ports.has(443))) return 'Roteador/Gateway'
  if (ports.has(3389)) return 'Computador Windows'
  if (ports.has(548) || ports.has(445)) return 'Compartilhamento de Arquivos'
  if (ports.has(1883) || ports.has(8883)) return 'Dispositivo IoT'
  if (ports.has(80) || ports.has(443)) return 'Dispositivo Web'
  if (ports.has(23)) return 'Dispositivo Legacy'
  return 'Dispositivo'
}
