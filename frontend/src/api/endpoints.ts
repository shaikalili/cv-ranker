import { apiClient } from './client'
import {
  AuthResponse,
  JobPosition,
  ProgressSnapshot,
  ResultsResponse,
  CV,
  CVTier,
  Requirement,
} from './types'

export const authApi = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const { data } = await apiClient.post<AuthResponse>('/auth/login', {
      email,
      password,
    })
    return data
  },

  register: async (
    email: string,
    password: string,
    name: string,
  ): Promise<AuthResponse> => {
    const { data } = await apiClient.post<AuthResponse>('/auth/register', {
      email,
      password,
      name,
    })
    return data
  },

  getProfile: async () => {
    const { data } = await apiClient.get('/users/me')
    return data
  },
}

export const jobPositionsApi = {
  list: async (): Promise<JobPosition[]> => {
    const { data } = await apiClient.get<JobPosition[]>('/job-positions')
    return data
  },

  get: async (jobPositionId: string): Promise<JobPosition> => {
    const { data } = await apiClient.get<JobPosition>(
      `/job-positions/${jobPositionId}`,
    )
    return data
  },

  create: async (
    title: string,
    jobDescriptionText: string,
  ): Promise<JobPosition> => {
    const { data } = await apiClient.post<JobPosition>('/job-positions', {
      title,
      jobDescriptionText,
    })
    return data
  },

  extractRequirements: async (jobPositionId: string): Promise<void> => {
    await apiClient.post(`/job-positions/${jobPositionId}/extract-requirements`)
  },

  updateRequirements: async (
    jobPositionId: string,
    requirements: Requirement[],
  ): Promise<JobPosition> => {
    const { data } = await apiClient.put<JobPosition>(
      `/job-positions/${jobPositionId}/requirements`,
      { requirements },
    )
    return data
  },

  uploadCvs: async (
    jobPositionId: string,
    files: File[],
  ): Promise<{ queued: number }> => {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))

    const { data } = await apiClient.post<{ queued: number }>(
      `/job-positions/${jobPositionId}/cvs`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return data
  },

  getResults: async (jobPositionId: string): Promise<ResultsResponse> => {
    const { data } = await apiClient.get<ResultsResponse>(
      `/job-positions/${jobPositionId}/results`,
    )
    return data
  },

  getProgress: async (jobPositionId: string): Promise<ProgressSnapshot> => {
    const { data } = await apiClient.get<ProgressSnapshot>(
      `/job-positions/${jobPositionId}/progress`,
    )
    return data
  },

  overrideTier: async (
    jobPositionId: string,
    cvId: string,
    tier: CVTier,
  ): Promise<CV> => {
    const { data } = await apiClient.put<CV>(
      `/job-positions/${jobPositionId}/cvs/${cvId}/override-tier`,
      { tier },
    )
    return data
  },

  delete: async (jobPositionId: string): Promise<void> => {
    await apiClient.delete(`/job-positions/${jobPositionId}`)
  },

  rescore: async (jobPositionId: string): Promise<{ queued: number }> => {
    const { data } = await apiClient.post<{ queued: number }>(
      `/job-positions/${jobPositionId}/rescore`,
    )
    return data
  },

  generateCvs: async (
    jobPositionId: string,
    params: {
      count: number
      qualityMix: { strong: number; partial: number; weak: number }
      format: 'pdf' | 'docx'
    },
  ): Promise<{ queued: number }> => {
    const { data } = await apiClient.post<{ queued: number }>(
      `/job-positions/${jobPositionId}/generate-cvs`,
      params,
    )
    return data
  },
}
