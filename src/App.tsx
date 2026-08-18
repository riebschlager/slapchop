import { useEffect } from 'react';
import AppShell from './components/AppShell';
import { redo, undo } from './store';
import { saveProject } from './lib/project';

export default function App() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      // Don't hijack shortcuts while typing in a text field
      const target = e.target as HTMLElement | null;
      const isTyping = target instanceof HTMLInputElement
        ? target.type === 'text' || target.type === 'number'
        : target instanceof HTMLTextAreaElement;

      const key = e.key.toLowerCase();
      if (key === 'z' && !isTyping) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 's') {
        e.preventDefault();
        saveProject();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex w-full h-screen font-sans bg-gray-950 overflow-hidden text-gray-100">
      <AppShell />
    </div>
  );
}
