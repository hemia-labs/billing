import { isURL } from 'class-validator';

export const checkoutReturnUrlOptions = {
  require_tld: false,
  require_protocol: true,
  protocols: ['https', 'http'],
  disallow_auth: true,
};

export function parseCheckoutReturnUrl(value: string): URL | null {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !isURL(value, checkoutReturnUrlOptions) ||
    value.includes('\\')
  )
    return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

export function isLocalCheckoutReturnUrl(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  );
}
