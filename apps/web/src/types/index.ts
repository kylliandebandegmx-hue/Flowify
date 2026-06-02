export interface Track {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string;
  viewCount: string;
  publishedAt: string;
  description: string;
  source?: 'youtube' | 'cloud';
  storageKey?: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  url?: string;
  addedById?: string | null;
  addedBy?: PlaylistMember;
}

export interface SearchResult {
  tracks: Track[];
  nextPageToken: string;
  totalResults: number;
}

export interface ApiHealth {
  ok: boolean;
  youtubeConfigured: boolean;
  ytdlpAvailable: boolean;
  apiReachable?: boolean;
  cloudStorageAvailable?: boolean;
  cloudBucketConfigured?: boolean;
  cloudBucketValid?: boolean;
  cloudBucketName?: string;
  cloudEndpointConfigured?: boolean;
  cloudPublicBaseUrl?: boolean;
}

export interface CloudTrackRow {
  id: string;
  user_id: string;
  storage_key: string;
  title: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  track: Track;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface SavedTrackRow {
  id: string;
  user_id: string;
  youtube_id: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  duration: string | null;
  track: Track;
  created_at: string;
}

export interface PlaylistTrackRow {
  id: string;
  playlist_id: string;
  youtube_id?: string;
  position?: number;
  track: Track;
  added_by: string | null;
  created_at: string;
}

export interface PlaylistMemberRow {
  playlist_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at?: string;
}

export interface PlaylistMember {
  userId: string;
  role: 'owner' | 'member';
  displayName: string;
  avatarUrl: string;
  joinedAt?: string;
}

export interface PlaylistRow {
  id: string;
  owner_id: string;
  name: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
  playlist_tracks?: PlaylistTrackRow[];
  playlist_members?: PlaylistMemberRow[];
}

export interface Playlist {
  id: string;
  ownerId: string;
  name: string;
  inviteCode: string;
  tracks: Track[];
  members: PlaylistMember[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
