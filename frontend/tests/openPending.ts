import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Explicitly inspect optional proposals; normal conversation never opens this automatically. */
export async function openPending(){const summary=await screen.findByText(/^Pending case changes \(/);const details=summary.closest('details');if(!details?.open)await userEvent.click(summary);}
export async function openClarification(){const summary=await screen.findByText('Clarification options');if(!summary.closest('details')?.open)await userEvent.click(summary);}
