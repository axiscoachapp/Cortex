import { LoadErrorNotice, LoadingNotice, NoAccessNotice } from '@/features/shared/StatusNotice';

/**
 * Loading and error states of the reception screens, drawn by the shared notices. Reception errors
 * are already written for people by `receptionApi` (server text is never passed through), so their
 * message is shown as is.
 */
export function ReceptionNotice({
  error,
  loading,
  onRetry,
}: {
  error?: unknown;
  loading?: boolean;
  onRetry?: () => void;
}) {
  if (loading) return <LoadingNotice />;
  if (!error) return null;
  return <LoadErrorNotice message={error instanceof Error ? error.message : undefined} onRetry={onRetry} />;
}

/** A reception page the person cannot use: its name, what they cannot do, who can grant it, and a way back. */
export function ReceptionAccessNotice(props: {
  title: string;
  message: string;
  grantedBy?: string | null;
  backTo?: string;
  backLabel?: string;
  headingLevel?: 1 | 2;
}) {
  return <NoAccessNotice {...props} />;
}
