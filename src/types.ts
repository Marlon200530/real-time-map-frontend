export type LocationUpdate = {
  lat: number;
  lng: number;
};

export type LiveUser = {
  id: string;        // socket.id
  lat: number;
  lng: number;
  updatedAt: number;
};