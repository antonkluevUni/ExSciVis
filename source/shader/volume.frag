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
					dst = vec4(pow(linearColor, gamma), surfaceColor.a);
					// Add Shadows
					#if ENABLE_SHADOWING == 1
						bool run  = true;
						vec3 ray  = sampling_pos;
						vec3 step2 = surfaceToLight * length(ray_increment);
						while (run) {
							ray += step2;
							bool hit = get_sample_data(ray) > iso_value;
							run = !(hit || !inside_volume_bounds(ray));
							if (hit) dst = vec4(ambient, surfaceColor.a);
						}
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
		// the traversal loop,
		// termination when the sampling position is outside volume boundarys
		// another termination condition for early ray termination is added
		while (inside_volume) {
			// get sample
			#if ENABLE_OPACITY_CORRECTION == 1 // Opacity Correction
				IMPLEMENT;
			#else
				float s = get_sample_data(sampling_pos);
			#endif
			// dummy code
			dst = vec4(light_specular_color, 1.0);
			// increment the ray sampling position
			sampling_pos += ray_increment;
			#if ENABLE_LIGHTNING == 1 // Add Shading
				IMPLEMENT;
			#endif
			// update the loop termination condition
			inside_volume = inside_volume_bounds(sampling_pos);
		}
	#endif 
	// return the calculated color value
	FragColor = dst;
}
