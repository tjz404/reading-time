import { createSampleReport } from '../lib/sample';

export const demoMode = import.meta.env.MODE === 'demo';
export const demoReport = () => createSampleReport();
