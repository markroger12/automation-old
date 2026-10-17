'use client';

import { useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { getModule } from '@/modules/registry';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useTaskAction } from './use-task-action';

export function RegenerateModal({
  taskId,
  moduleKey,
  open,
  onClose,
  onDone,
  initialStage,
}: {
  taskId: string;
  moduleKey: string;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
  initialStage?: string;
}) {
  const stages = getModule(moduleKey)?.stages.filter((s) => s.regenerable) ?? [];
  const [stage, setStage] = useState(initialStage ?? stages[0]?.key ?? '');
  const { run, isPending } = useTaskAction(onDone);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Regenerate a stage"
      description="The stage is re-run in the same ChatGPT conversation. Other stages are kept — no full restart."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<RefreshCcw className="h-4 w-4" />}
            loading={isPending(taskId, 'regenerate')}
            disabled={!stage}
            onClick={async () => {
              if (await run(taskId, { action: 'regenerate', stage })) onClose();
            }}
          >
            Regenerate
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {stages.map((s) => (
          <label key={s.key} className="flex cursor-pointer items-center gap-3 rounded-lg p-3 ring-1 ring-slate-200 hover:bg-slate-50 has-[:checked]:bg-indigo-50 has-[:checked]:ring-indigo-300">
            <input type="radio" name="stage" value={s.key} checked={stage === s.key} onChange={() => setStage(s.key)} className="accent-indigo-600" />
            <span className="text-sm font-medium text-slate-800">Regenerate {s.label}</span>
          </label>
        ))}
        <p className="pt-2 text-xs text-slate-500">
          Regenerating the Final Article, FAQs or Quick Bio also re-assembles the article and re-runs the SEO check. Use “Send to WordPress” afterwards to update an existing draft.
        </p>
      </div>
    </Modal>
  );
}
