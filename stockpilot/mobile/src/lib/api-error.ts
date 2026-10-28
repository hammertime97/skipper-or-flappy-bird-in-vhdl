export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }

  /** The server wants the user to upgrade (free AI quota used, or a Pro-only feature). */
  get needsUpgrade() {
    return this.status === 402 && this.code === 'upgrade_required';
  }
}
