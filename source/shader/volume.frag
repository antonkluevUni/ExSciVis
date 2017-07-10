#version 150
//#extension GL_ARB_shading_language_420pack : require
#extension GL_ARB_explicit_attrib_location : require

#define TASK 10
#define ENABLE_OPACITY_CORRECTION 0
#define ENABLE_LIGHTNING 0
#define ENABLE_SHADOWING 0

in vec3 ray_entry_position;

layout(location = 0) out vec4 FragColor;

uniform mat4 Modelview;

uniform sampler3D volume_texture;
uniform sampler2D transfer_texture;

uniform vec3    camera_location;
uniform float   sampling_distance;
uniform float   sampling_distance_ref;
uniform float   iso_value;
uniform vec3    max_bounds;
uniform ivec3   volume_dimensions;

uniform vec3    light_position;
uniform vec3    light_ambient_color;
uniform vec3    light_diffuse_color;
uniform vec3    light_specular_color;
uniform float   light_ref_coef;

bool inside_volume_bounds(const in vec3 sampling_position) {
	return (all(greaterThanEqual(sampling_position, vec3(0.0)))
	&& all(lessThanEqual(sampling_position, max_bounds)));
}


float get_sample_data(vec3 in_sampling_pos) {
	vec3 obj_to_tex = vec3(1.0) / max_bounds;
	return texture(volume_texture, in_sampling_pos * obj_to_tex).r;
}

vec3 get_gradient (vec3 sampling_pos) {
	// Dx = (f(x + 1, y, z) - f(x - 1, y, z))/2;
	vec3 a = max_bounds / volume_dimensions;
	return vec3(
		(get_sample_data(sampling_pos + vec3( a.r,   0,   0)) -	  // left
		 get_sample_data(sampling_pos + vec3(-a.r,   0,   0)))/2, // right
		(get_sample_data(sampling_pos + vec3(   0, a.g,   0)) -   // top
		 get_sample_data(sampling_pos + vec3(   0,-a.g,   0)))/2, // bottom
		(get_sample_data(sampling_pos + vec3(   0,   0, a.b)) -   // front
		 get_sample_data(sampling_pos + vec3(   0,   0,-a.b)))/2  // bottom
	);
}

vec4 get_pre_classification (vec3 sampling_pos) {
	// transform from texture space to array space
	// ie: (0.3, 0.5, 1.0) -> (76.5 127.5 255.0)
	vec3 arraySpace = sampling_pos * vec3(volume_dimensions);
	float lX = floor(arraySpace.x); float uX = ceil(arraySpace.x);
	float lY = floor(arraySpace.y); float uY = ceil(arraySpace.y);
	float lZ = floor(arraySpace.z); float uZ = ceil(arraySpace.z);
	// texture
	vec3 objToTex = vec3(1.0) / max_bounds;
	float t0 = texture(volume_texture, vec3(lX, uY, lZ) / vec3(volume_dimensions) * objToTex).r;
	float t1 = texture(volume_texture, vec3(uX, uY, lZ) / vec3(volume_dimensions) * objToTex).r;
	float t2 = texture(volume_texture, vec3(uX, uY, uZ) / vec3(volume_dimensions) * objToTex).r;
	float t3 = texture(volume_texture, vec3(lX, uY, uZ) / vec3(volume_dimensions) * objToTex).r;
	float t4 = texture(volume_texture, vec3(lX, lY, lZ) / vec3(volume_dimensions) * objToTex).r;
	float t5 = texture(volume_texture, vec3(uX, lY, lZ) / vec3(volume_dimensions) * objToTex).r;
	float t6 = texture(volume_texture, vec3(uX, lY, uZ) / vec3(volume_dimensions) * objToTex).r;
	float t7 = texture(volume_texture, vec3(lX, lY, uZ) / vec3(volume_dimensions) * objToTex).r;
	// uvw
	float u = (arraySpace.x - lX) / (uX - lX);
	float v = (arraySpace.y - lY) / (uY - lY);
	float w = (arraySpace.z - lZ) / (uZ - lZ);
	// texture
	vec4 t8  = (1-u) * texture(transfer_texture, vec2(t4, t4)) + u * texture(transfer_texture, vec2(t5, t5));
	vec4 t9  = (1-u) * texture(transfer_texture, vec2(t0, t0)) + u * texture(transfer_texture, vec2(t1, t1));
	vec4 t10 = (1-u) * texture(transfer_texture, vec2(t7, t7)) + u * texture(transfer_texture, vec2(t6, t6));
	vec4 t11 = (1-u) * texture(transfer_texture, vec2(t3, t3)) + u * texture(transfer_texture, vec2(t2, t2));
	vec4 t12 = (1-w) * t8 + w * t10;
	vec4 t13 = (1-w) * t9 + w * t11;
	return (1-v) * t12 + v * t13;
}

vec4 phong_shading (vec4 surfaceColor, vec3 sampling_pos) {
	// find gradient and normal
	vec3 gradient = get_gradient(sampling_pos);
	vec3 normal = normalize(gradient * -1);
	// dst = vec4(normal/2 + 0.5, 1.0);
	// http://www.tomdalling.com/blog/modern-opengl/07-more-lighting-ambient-specular-attenuation-gamma/
	// phong shading
	vec3 surfaceToLight = normalize(light_position - sampling_pos);
	// ambient
	vec3 ambient = 0.05 * surfaceColor.rgb;
	// diffuse
	float diffuseCoefficient = max(0.0, dot(normal, surfaceToLight));
	vec3 diffuse = diffuseCoefficient * surfaceColor.rgb;
	// linear color
	vec3 linearColor = ambient + diffuse;
	vec3 gamma = vec3(1.0 / 2.2);
	return vec4(pow(linearColor, gamma), surfaceColor.a);
}

vec4 shadowing (vec4 surfaceColor, vec3 sampling_pos) {
	vec3 surfaceToLight = normalize(light_position - sampling_pos);
	vec3 ambient = 0.05 * surfaceColor.rgb;
	vec3 step2 = surfaceToLight * sampling_distance;
	bool run  = true;
	vec3 ray  = sampling_pos;
	while (run) {
		ray += step2;
		bool hit = get_sample_data(ray) > iso_value;
		run = !(hit || !inside_volume_bounds(ray));
		if (hit) return vec4(ambient, surfaceColor.a);
	}
	return surfaceColor;
}



void main() {
	/// One step trough the volume
	vec3 ray_increment = normalize(ray_entry_position - camera_location) * sampling_distance;
	/// Position in Volume
	vec3 sampling_pos = ray_entry_position + ray_increment; // test, increment just to be sure we are in the volume
	/// Init color of fragment
	vec4 dst = vec4(.0,.0,.0,.0);
	/// check if we are inside volume
	bool inside_volume = inside_volume_bounds(sampling_pos);
	if (!inside_volume) discard;
	
	#if TASK == 10
		vec4 max_val = vec4(.0,.0,.0,.0);
		// the traversal loop,
		// termination when the sampling position is outside volume boundarys
		// another termination condition for early ray termination is added
		while (inside_volume) {
			// get sample
			float s = get_sample_data(sampling_pos);
			// apply the transfer functions to retrieve color and opacity
			vec4 color = texture(transfer_texture, vec2(s, s));
			// this is the example for maximum intensity projection
			max_val.r = max(color.r, max_val.r);
			max_val.g = max(color.g, max_val.g);
			max_val.b = max(color.b, max_val.b);
			max_val.a = max(color.a, max_val.a);
			// increment the ray sampling position
			sampling_pos += ray_increment;
			// update the loop termination condition
			inside_volume = inside_volume_bounds(sampling_pos);
		}
		dst = max_val;
	#endif 
	
	#if TASK == 11
		// the traversal loop,
		// termination when the sampling position is outside volume boundarys
		// another termination condition for early ray termination is added
		vec4 valueAcc = vec4(.0,.0,.0,.0);
		int totalSize = 0;
		while (inside_volume) {
			// get sample
			float s = get_sample_data(sampling_pos);
			// apply the transfer functions to retrieve color and opacity
			vec4 color = texture(transfer_texture, vec2(s, s));
			// dummy code
			valueAcc += color;
			totalSize ++;
			// dst = vec4(sampling_pos, 1.0);
			// increment the ray sampling position
			sampling_pos += ray_increment;
			// update the loop termination condition
			inside_volume = inside_volume_bounds(sampling_pos);
		}
		valueAcc /= totalSize;
		dst = valueAcc;
	#endif
	
	#if TASK == 12 || TASK == 13
		// the traversal loop,
		// termination when the sampling position is outside volume boundarys
		// another termination condition for early ray termination is added
		dst = vec4(.0,.0,.0,.0);
		while (inside_volume) {
			// get sample
			float s = get_sample_data(sampling_pos);
			vec4 surfaceColor = texture(transfer_texture, vec2(s, s));
			// check for threshold
			if (s > iso_value) {
				// to stop the loop
				inside_volume = false;
				dst = surfaceColor;
				// Binary Search
				#if TASK == 13
					float step1 = 1;
					int times = 0;
					while (times < 10) {
						float value = get_sample_data(sampling_pos + step1 * ray_increment);
						step1 *= value > iso_value? -.5: .5;
						times ++;
					}
					sampling_pos += step1 * ray_increment;
				#endif
				#if ENABLE_LIGHTNING == 1 // Add Shading
					dst = phong_shading(surfaceColor, sampling_pos);
					// Add Shadows
					#if ENABLE_SHADOWING == 1
						dst = shadowing(dst, sampling_pos);
					#endif
				#endif
			} else {
				// increment the ray sampling position
				sampling_pos += ray_increment;
				// update the loop termination condition
				inside_volume = inside_volume_bounds(sampling_pos);
			}
		}
	#endif 
	
	#if TASK == 31
		bool backToFront = true;
		bool preClassification = false;
		// the traversal loop,
		// termination when the sampling position is outside volume boundarys
		// another termination condition for early ray termination is added
		float adapted_sampling_distance = sampling_distance;
		ray_increment = normalize(ray_entry_position - camera_location) * adapted_sampling_distance;
		vec4 acc      = vec4(0,0,0,0);
		int  first    = -1;
		int  iterator = 0;
		if (backToFront) {
			while (inside_volume) {
				float s1 = get_sample_data(sampling_pos);
				vec4 c = texture(transfer_texture, vec2(s1, s1));
				if (c.a > .1 && first == -1) first = iterator;
				iterator ++;
				// increment the ray sampling position
				sampling_pos += ray_increment;
				// update the loop termination condition
				inside_volume = inside_volume_bounds(sampling_pos);
			}
			inside_volume = true;
		}
		// loop
		while (inside_volume) {
			vec4 c = vec4(0,0,0,0);
			// get value
			if (preClassification) 
				c = get_pre_classification(sampling_pos);
			else {
				float s1 = get_sample_data(sampling_pos);
				c = texture(transfer_texture, vec2(s1, s1));
			}
			// get sample
			#if ENABLE_OPACITY_CORRECTION == 1 // Opacity Correction
				c.a = 1 - pow(1 - c.a, adapted_sampling_distance / sampling_distance);
			#else
				// float s = get_sample_data(sampling_pos);
			#endif
			// front to back
			float o = (1 - acc.a) * c.a * .5;
			acc.a   += o;
			acc.rgb += o * c.rgb;
			if (backToFront) {
				if (first == iterator) {
					#if ENABLE_LIGHTNING == 1 // Add Shading
						acc = phong_shading(acc, sampling_pos);
					#endif
					#if ENABLE_SHADOWING == 1 // Add Shading
						acc = shadowing(acc, sampling_pos);
					#endif
				}
				iterator --;
			} else {
				if (first == -1 && acc.a > 0.1) {
					first = 1;
					#if ENABLE_LIGHTNING == 1 // Add Shading
						acc = phong_shading(acc, sampling_pos);
					#endif
					#if ENABLE_SHADOWING == 1 // Add Shading
						acc = shadowing(acc, sampling_pos);
					#endif
				}
			}
			// increment the ray sampling position
			sampling_pos = sampling_pos + ray_increment * (backToFront? -1: 1);
			// update the loop termination condition
			inside_volume = acc.a >= 1? false: inside_volume_bounds(sampling_pos);
		}
		dst = acc;
	#endif 
	// return the calculated color value
	FragColor = dst;
}
