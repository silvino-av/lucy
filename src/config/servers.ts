import fs from "fs";
import path from "path";

export interface ServerConfig {
  id: string;              // Identificador / alias (ej: "principal", "db", "vps2")
  name: string;            // Nombre descriptivo (ej: "Servidor Principal")
  host: string;            // IP o nombre de dominio (ej: "saguiar.cloud")
  user: string;            // Usuario de SSH (ej: "silvino")
  port?: number;           // Puerto SSH (por defecto 22)
  isDefault?: boolean;     // Marcar si es el servidor por defecto
  description?: string;    // Qué corre en este servidor (ej: "Bases de datos", "Docker")
  password?: string;       // Contraseña opcional (si no usa llave SSH)
  privateKeyPath?: string; // Ruta opcional a llave privada
}

/**
 * Obtiene la lista de servidores configurados desde servers.json
 * con fallback a las variables de entorno de .env.
 */
export function getServers(): ServerConfig[] {
  const serversFilePath = path.resolve(process.cwd(), "servers.json");
  let list: ServerConfig[] = [];

  if (fs.existsSync(serversFilePath)) {
    try {
      const content = fs.readFileSync(serversFilePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        list = parsed;
      }
    } catch (err) {
      console.warn("⚠️ [Servers] Error leyendo servers.json:", err);
    }
  }

  // Fallback si servers.json no existe o está vacío
  if (list.length === 0 && process.env.SSH_HOST) {
    list.push({
      id: "principal",
      name: "Servidor Principal",
      host: process.env.SSH_HOST,
      user: process.env.SSH_USERNAME || "silvino",
      port: 22,
      isDefault: true,
      description: "Servidor principal configurado en .env",
      password: process.env.SSH_PASSWORD,
      privateKeyPath: process.env.SSH_PRIVATE_KEY_PATH,
    });
  }

  return list;
}

/**
 * Busca un servidor por ID, host, nombre descriptivo o retorna el por defecto.
 */
export function findServer(query?: string): ServerConfig | undefined {
  const servers = getServers();
  if (servers.length === 0) return undefined;

  if (!query || query.trim() === "" || query.toLowerCase() === "default") {
    return servers.find((s) => s.isDefault) || servers[0];
  }

  const clean = query.trim().toLowerCase();

  // 1. Coincidencia exacta por ID
  const byId = servers.find((s) => s.id.toLowerCase() === clean);
  if (byId) return byId;

  // 2. Coincidencia por Host o user@host
  const byHost = servers.find((s) => s.host.toLowerCase() === clean || `${s.user}@${s.host}`.toLowerCase() === clean);
  if (byHost) return byHost;

  // 3. Coincidencia parcial por nombre o descripción
  const byName = servers.find((s) => 
    s.name.toLowerCase().includes(clean) || 
    (s.description && s.description.toLowerCase().includes(clean))
  );
  if (byName) return byName;

  // 4. Si el query es un host directo (ej. "192.168.1.100" o "usuario@servidor.com") que no está registrado
  if (clean.includes(".") || clean.includes("@")) {
    const parts = clean.split("@");
    const user = parts.length > 1 ? parts[0]! : (process.env.SSH_USERNAME || "silvino");
    const host = parts.length > 1 ? parts[1]! : parts[0]!;
    return {
      id: host,
      name: `Servidor ${host}`,
      host: host,
      user: user,
      port: 22,
    };
  }

  // Fallback al por defecto
  return servers.find((s) => s.isDefault) || servers[0];
}
