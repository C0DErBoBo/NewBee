import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompetitionWizard } from './CompetitionWizard';
import * as competitionService from '@/services/competitions';

vi.spyOn(competitionService, 'fetchEventTemplates').mockResolvedValue([
  { name: '100m', category: 'track', unitType: 'individual' }
]);
vi.spyOn(competitionService, 'fetchCompetitions').mockResolvedValue([]);
vi.spyOn(competitionService, 'createCompetition').mockResolvedValue({
  id: 'comp-1'
});

function renderWizard() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CompetitionWizard />
    </QueryClientProvider>
  );
}

describe('CompetitionWizard', () => {
  it('allows switching steps and validates progression', async () => {
    renderWizard();
    const nextButton = screen.getByRole('button', { name: '下一步' });
    expect(nextButton).toBeEnabled();
    await userEvent.click(nextButton);

    await waitFor(() =>
      expect(
        screen.getByText('选择或新增竞赛项目，每个项目可标记为团体或个人。')
      ).toBeInTheDocument()
    );
  });
});
