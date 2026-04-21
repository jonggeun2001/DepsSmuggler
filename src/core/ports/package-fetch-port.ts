export interface PackageRef {
  url: string;
  filename?: string;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface PackageHead {
  url: string;
  status: number;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  headers: Record<string, string>;
}

export interface PackageFetchPort {
  fetchPackageFile(ref: PackageRef): Promise<NodeJS.ReadableStream>;
  headPackage(ref: PackageRef): Promise<PackageHead>;
}
