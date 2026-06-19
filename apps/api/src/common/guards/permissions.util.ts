export const hasPermission = (
  grantedPermissions: string[],
  requiredPermission: string,
): boolean => {
  if (grantedPermissions.includes('*.*')) {
    return true;
  }

  if (grantedPermissions.includes(requiredPermission)) {
    return true;
  }

  const [resource] = requiredPermission.split('.');
  return grantedPermissions.includes(`${resource}.*`);
};

export const hasAllPermissions = (
  grantedPermissions: string[],
  requiredPermissions: string[],
): boolean =>
  requiredPermissions.every((permission) =>
    hasPermission(grantedPermissions, permission),
  );
