const configuredBase = import.meta.env.BASE_URL || "/";

export const basePath = configuredBase.endsWith("/")
  ? configuredBase
  : `${configuredBase}/`;

export const socketPath = `${basePath}socket.io`;

export function appPath(path: string): string {
  return `${basePath}${path.replace(/^\/+/, "")}`;
}

export function currentAppPath(): string {
  const pathname = window.location.pathname;
  const prefix = basePath === "/" ? "" : basePath.slice(0, -1);
  const underBase =
    prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`));
  const relative = underBase ? pathname.slice(prefix.length) : pathname;
  return relative.replace(/\/$/, "") || "/";
}
