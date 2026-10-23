// Test-only sessions. Replace these callbacks with your existing session/membership service.
const { UnauthorizedException, ForbiddenException } = require('@nestjs/common');
function atlasAuthorization(sessions, webOrigin) {
  return {
    authorize: async (request, operation) => {
      const key = /(?:^|;\s*)atlas_session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
      const session = sessions.get(key);
      if (!session || !session.active) throw new UnauthorizedException();
      if (!session.permissions.includes(operation)) throw new ForbiddenException();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== webOrigin)
        throw new ForbiddenException('Invalid request origin');
      return { organizationId: session.organizationId, subjectId: session.subjectId, sessionId: session.id };
    },
    resolveContext: async (input) => {
      const session = [...sessions.values()].find((s) => s.active &&
        s.organizationId === input.organizationId && s.subjectId === input.subjectId &&
        (input.purpose !== 'acceptance' || s.id === input.sessionId));
      if (!session || !session.membershipId || !session.permissions.includes('legal.accept'))
        throw new ForbiddenException('Current contracting membership required');
      return { organizationId: session.organizationId, subjectId: session.subjectId,
        membershipId: session.membershipId, roles: session.roles, canContract: true };
    },
  };
}
module.exports = { atlasAuthorization };
