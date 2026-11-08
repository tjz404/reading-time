import { CircleAlert } from 'lucide-react';
import { HoverDetail } from './HoverDetail';

export function InfoTip({ label, text }: { label: string; text: string }) {
  return <HoverDetail className="context-info" ariaLabel={label} text={text}><CircleAlert size={17} strokeWidth={1.6} /></HoverDetail>;
}
