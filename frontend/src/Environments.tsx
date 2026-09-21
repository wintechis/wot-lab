import { useEffect, useState } from 'react';
import { Button, ConfirmationDialog, Dialog, Flash, Label, Spinner, Stack, Text } from '@primer/react';
import { PlayIcon } from '@primer/octicons-react';

import { EnvSummary, labEnvironments, startEnvironment } from './api';

// Starting an environment replaces whatever is running: an environment pins its
// ids, so it is only reproducible when the lab holds exactly its manifest.
// Returns a failure message, or '' when the environment is online.
export async function replaceWithEnvironment(name: string): Promise<string> {
  try {
    const result = await startEnvironment(name, true);
    return result.ok ? '' : result.body.error || 'Unable to start the environment.';
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Unable to start the environment.';
  }
}

export function StartEnvironmentDialog({ running, onClose, onStarted }: {
  // How many Things a start would take offline.
  running: number;
  onClose: () => void;
  onStarted: (name: string) => void;
}) {
  const [environments, setEnvironments] = useState<EnvSummary[] | null>(null);
  const [current, setCurrent] = useState<string | undefined>();
  const [pending, setPending] = useState<EnvSummary | null>(null);
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void labEnvironments(controller.signal)
      .then(result => { setEnvironments(result.environments); setCurrent(result.current); })
      .catch(cause => { if (!controller.signal.aborted) setFailure(cause instanceof Error ? cause.message : 'Unable to list environments.'); });
    return () => controller.abort();
  }, []);

  async function start(environment: EnvSummary) {
    setBusy(environment.name);
    setFailure('');
    const problem = await replaceWithEnvironment(environment.name);
    setBusy('');
    if (problem) { setFailure(problem); return; }
    onStarted(environment.name);
  }

  return <>
    <Dialog title="Start an environment" width="xlarge" onClose={onClose}>
      <Stack gap="normal">
        <Text className="muted">
          An environment is a fixed set of Things under fixed ids, with the initial state a benchmark
          task starts from. Starting one takes everything that is running offline first.
        </Text>
        {failure && <Flash variant="danger">{failure}</Flash>}
        {!environments
          ? !failure && <Stack align="center" padding="normal"><Spinner /></Stack>
          : environments.length
            ? <div className="table-scroll">
                <table className="aff-table aff-table--grow">
                  <thead><tr><th>Environment</th><th>Things</th><th>Tasks</th><th /></tr></thead>
                  <tbody>
                    {environments.map(environment => <tr key={environment.name}>
                      <td>
                        <Stack gap="none">
                          <Stack direction="horizontal" align="center" gap="condensed">
                            <Text className="mono" weight="semibold">{environment.name}</Text>
                            {environment.name === current && <Label variant="success">running</Label>}
                          </Stack>
                          {environment.description && <Text size="small" className="muted">{environment.description}</Text>}
                        </Stack>
                      </td>
                      <td className="cell-shrink">{environment.things}</td>
                      <td className="cell-shrink">{environment.tasks}</td>
                      <td className="cell-shrink">
                        <Button size="small" leadingVisual={PlayIcon} disabled={Boolean(busy)} loading={busy === environment.name}
                          onClick={() => running ? setPending(environment) : void start(environment)}>
                          {environment.name === current ? 'Restart' : 'Start'}
                        </Button>
                      </td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            : <Text className="muted">No environments were found in <Text as="span" className="mono">src/environments/</Text>.</Text>}
      </Stack>
    </Dialog>

    {pending && <ConfirmationDialog title={`Start ${pending.name}?`} confirmButtonType="danger" confirmButtonContent="Replace and start"
      onClose={gesture => { const target = pending; setPending(null); if (gesture === 'confirm') void start(target); }}>
      <Text>
        Takes {running === 1 ? 'the 1 running Thing' : `all ${running} running Things`} offline and brings
        up the {pending.things} of <Text as="span" className="mono">{pending.name}</Text>. Thing Models on disk are not touched.
      </Text>
    </ConfirmationDialog>}
  </>;
}
