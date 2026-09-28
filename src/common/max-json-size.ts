import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Largest page theme we store, as serialized JSON. Real themes are well under 2 KB. */
export const MAX_THEME_BYTES = 16 * 1024;

/**
 * Rejects a value whose JSON form is larger than `maxBytes` (UTF-8). For free-form
 * JSON columns such as `Page.theme`, whose shape the backend does not validate.
 */
export function MaxJsonSize(maxBytes: number, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxJsonSize',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} is too large (max ${Math.round(maxBytes / 1024)} KB)`,
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          try {
            return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes;
          } catch {
            return false;
          }
        },
      },
    });
  };
}
