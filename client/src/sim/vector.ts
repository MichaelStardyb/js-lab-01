export class Vector2 {
    readonly x: number;
    readonly y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    add(v: Vector2) { return new Vector2(this.x + v.x, this.y + v.y); }
    sub(v: Vector2) { return new Vector2(this.x - v.x, this.y - v.y); }
    scale(n: number) { return new Vector2(this.x * n, this.y * n); }
    length() { return Math.hypot(this.x, this.y); }
    normalize() { 
        const l = this.length(); 
        return l === 0 ? new Vector2(0,0) : this.scale(1/l); 
    }
    static fromAngle(angle: number) { 
        return new Vector2(Math.cos(angle), Math.sin(angle)); 
    }
}