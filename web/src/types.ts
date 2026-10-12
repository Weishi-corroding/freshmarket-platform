export interface User {id:string;username:string;name:string;role:string;capabilities:string[];}
export interface Category {id:string;name:string;icon:string;}
export interface Product {id:string;category_id:string;name:string;subtitle:string;description:string;price:number;original_price:number;stock:number;sales:number;image:string;unit:string;origin:string;storage:string;tag:string;active:number;reviews?:{rating:number;content:string;name:string;created_at:number}[];}
export interface Cart {items:(Product & {quantity:number})[];subtotal:number;deliveryFee:number;total:number;count:number;}
export interface Address {id:string;name:string;phone:string;detail:string;is_default:number;}
export interface Order {id:string;status:string;total:number;subtotal:number;delivery_fee:number;created_at:number;expires_at:number;delivery_slot:string;note:string;address:Address;items:{id:string;product_id:string;name:string;image:string;unit:string;price:number;quantity:number}[];refund:null|{id:string;status:string;reason:string;decision_note:string};reviews:{product_id:string}[];}
export interface Page<T> {items:T[];total:number;page:number;pageSize:number;}
