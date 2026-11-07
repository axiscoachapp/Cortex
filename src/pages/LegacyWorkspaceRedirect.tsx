import { Navigate, useSearchParams } from 'react-router-dom';

/** Bookmarks stay local. Clinical work now lives in the patient and Calendar. */
export default function LegacyWorkspaceRedirect() {
  const [params]=useSearchParams();
  const patientId=params.get('patient');
  const destination=patientId ? '/?'+new URLSearchParams({patient:patientId}).toString()
    : params.get('queue')==='scheduling' ? '/agenda?queue=scheduling' : '/';
  return <Navigate to={destination} replace/>;
}
