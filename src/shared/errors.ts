export class ApiError extends Error{constructor(public statusCode:number,public code:string,message:string){super(message)}}
export const unauthorized=()=>new ApiError(401,'UNAUTHORIZED','Authentication required');
