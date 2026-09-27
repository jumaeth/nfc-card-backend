import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The better-auth session for the request (incl. `authMethod`), set by BetterAuthGuard. */
export interface RequestSession {
  authMethod?: string | null;
  [key: string]: unknown;
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestSession | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ session?: RequestSession }>();
    return request.session;
  },
);
