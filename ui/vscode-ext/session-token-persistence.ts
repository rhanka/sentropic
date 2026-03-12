export const resolvePersistedVsCodeSessionToken = (input: {
  secretToken?: string | null;
  persistedToken?: string | null;
  settingToken?: string | null;
}): string => {
  const normalize = (value: string | null | undefined): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : '';
  };

  return (
    normalize(input.secretToken) ||
    normalize(input.persistedToken) ||
    normalize(input.settingToken)
  );
};
