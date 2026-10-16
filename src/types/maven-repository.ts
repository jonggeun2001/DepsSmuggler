export interface MavenRepositoryTestResult {
  success: boolean;
  message: string;
  repositoryUrl?: string;
  status?: number;
}
