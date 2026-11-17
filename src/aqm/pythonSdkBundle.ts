import qiskitWorkflowRaw from '@/.github/workflows/qiskit.yml?raw';
import pyProjectTomlRaw from '@/python/qiskit-verdant-aqm/pyproject.toml?raw';
import pyReadmeRaw from '@/python/qiskit-verdant-aqm/README.md?raw';
import pyAtlasUtqcRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/atlas_utqc.py?raw';
import pyBackendRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/backend.py?raw';
import pyHoloBridgeRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/holo_bridge.py?raw';
import pyPrimitivesRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/primitives.py?raw';
import pyProviderRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/provider.py?raw';
import pyUorcWireRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/uorc_wire.py?raw';
import pyTestOracleRaw from '@/python/qiskit-verdant-aqm/tests/test_qiskit_oracle.py?raw';
import upstreamTomlRaw from '@/upstream.toml?raw';

export interface PythonSdkSourceEntry {
  readonly key: string;
  readonly label: string;
  readonly downloadName: string;
  readonly content: string;
}

export const PYTHON_SDK_FILES: readonly PythonSdkSourceEntry[] = [
  {
    key: 'pyproject',
    label: 'pyproject.toml',
    downloadName: 'pyproject.toml',
    content: pyProjectTomlRaw,
  },
  {
    key: 'backend',
    label: 'qiskit_verdant_aqm/backend.py',
    downloadName: 'backend.py',
    content: pyBackendRaw,
  },
  {
    key: 'primitives',
    label: 'qiskit_verdant_aqm/primitives.py',
    downloadName: 'primitives.py',
    content: pyPrimitivesRaw,
  },
  {
    key: 'provider',
    label: 'qiskit_verdant_aqm/provider.py',
    downloadName: 'provider.py',
    content: pyProviderRaw,
  },
  {
    key: 'uorc-wire',
    label: 'qiskit_verdant_aqm/uorc_wire.py',
    downloadName: 'uorc_wire.py',
    content: pyUorcWireRaw,
  },
  {
    key: 'atlas-utqc',
    label: 'qiskit_verdant_aqm/atlas_utqc.py',
    downloadName: 'atlas_utqc.py',
    content: pyAtlasUtqcRaw,
  },
  {
    key: 'holo-bridge',
    label: 'qiskit_verdant_aqm/holo_bridge.py',
    downloadName: 'holo_bridge.py',
    content: pyHoloBridgeRaw,
  },
  {
    key: 'oracle-test',
    label: 'tests/test_qiskit_oracle.py',
    downloadName: 'test_qiskit_oracle.py',
    content: pyTestOracleRaw,
  },
  {
    key: 'upstream',
    label: 'upstream.toml',
    downloadName: 'upstream.toml',
    content: upstreamTomlRaw,
  },
  {
    key: 'workflow',
    label: '.github/workflows/qiskit.yml',
    downloadName: 'qiskit.yml',
    content: qiskitWorkflowRaw,
  },
  {
    key: 'readme',
    label: 'python/README.md',
    downloadName: 'README.md',
    content: pyReadmeRaw,
  },
];
